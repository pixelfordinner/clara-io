var fs = require('fs'),
    path = require('path'),
    querystring = require('querystring'),
    Curl = require('node-curl/lib/Curl');

var _data = {
  params: {},
  programOptions: [
    'sceneName',
    'pass',
    'width',
    'height',
    'startFrame',
    'endFrame'
  ],
  threads: 3,
  nextFrame: null
};

var render = {
  init: function(program, data) {
    _data._parent = data;
    render._registerCommand(program);
  },

  _registerCommand: function(program) {
    program
      .command('render <scene-uuid>')
        .description('renders one or more frames from a scene')
        .option('--scene-name <scene-name>', 'custom friendly scene name for file naming')
        .option('--start-frame <start-frame>', 'specify the starting frame')
        .option('--end-frame <end-frame>', 'specify the ending frame')
        .option('--pass <pass>', 'the name of the pass containing the render options')
        .option('--width <width>', 'width of the export')
        .option('--height <height>', 'height of the export')
        .option('--threads <threads>', 'number of concurrent workers (defaults to 3)')
        .action(render._run);
  },

  _run: function(sceneUUID, options) {
    render._loadOptions(options);
    render._checkReqParams(sceneUUID, options);
    render._renderScene(sceneUUID);
  },

  _loadOptions: function(options) {
    _data.params = {};
    _data.programOptions.forEach(function (programOption) {
      if (typeof options[programOption] !== 'undefined') {
        _data.params[programOption] = options[programOption];
      }
    });
  },

  _checkReqParams: function(sceneUUID, options) {
    if (typeof sceneUUID !== 'string') {
      throw new Error('sceneUUID parameter (string) is required ');
    }

    _data.programOptions.forEach(function (programOption) {
      if (typeof _data.params[programOption] === 'undefined') {
        throw new Error('Missing required option ' + programOption);
      }
    });

    if (typeof _data._parent.confFile.obj.user !== 'string' ||
        typeof _data._parent.confFile.obj.key !== 'string') {
      throw new Error('Username or API Key not found in config file.');
    }

    if (typeof options.threads !== 'undefined') {
      _data.threads = parseInt(options.threads) > 0 ? parseInt(options.threads) : _data.threads;
    }
  },

  _renderScene: function(sceneUUID) {
    _data.nextFrame = _data.params.startFrame;

    for (var i = 0; i < _data.threads && i <=  _data.params.endFrame; i++) {
      console.log(_data._parent.output.normal('Starting thread #' + i));
      render._renderSceneFrameWorker(sceneUUID);
    }
  },

  _renderSceneFrameWorker: function(sceneUUID) {
    var frame = _data.nextFrame++,
        opts = {
          time: frame,
          pass: _data.params.pass,
          width: _data.params.width,
          height: _data.params.height
        },
        query = querystring.stringify(opts);

    if (frame > _data.params.endFrame) {
      console.log(_data._parent.output.normal('Ending thread'));
      return;
    }

    var url = _data._parent.api.baseUrl + 'scenes/' + sceneUUID + '/render?' + query,
        fileName = _data.params.sceneName + '_' + render._padString(frame, '00000') + '.png';

    if (fs.existsSync(fileName)) {
      var stats = fs.statSync(fileName);
      if (stats.size > 0) {
        console.log(_data._parent.output.warning('Skipping frame #' + frame + ' already downloaded (' + fileName + ')'));
        render._renderSceneFrameWorker(sceneUUID);
        return;
      }
      console.log(_data._parent.output.warning('Frame #' + frame + ' file is empty, redownloading'));
    }

    var curl = new Curl();
    curl.setopt('URL', url);
    curl.setopt('USERPWD', _data._parent.confFile.obj.user + ':' + _data._parent.confFile.obj.key);
    curl.setopt('CONNECTTIMEOUT', 5);

    var wstream = fs.createWriteStream(fileName);

    curl.on('data', function(data) {
      wstream.write(data);
      return data.length;
    });

    curl.on('error', function(e) {
      console.log(_data._parent.output.error('Error: ' + e.message));
      wstream.end();

      render._renderSceneFrameWorker(sceneUUID);
    });

    curl.on('end', function() {
      console.log(_data._parent.output.success('Downloaded frame #' + frame + ' (' + fileName + ')'));
      wstream.end();

      render._renderSceneFrameWorker(sceneUUID);
    });

    console.log(_data._parent.output.info('Downloading frame #' + frame + ' (' + fileName + ')'));

    curl.perform();
  },

  _padString: function padNumberString(number, padStr) {
    var len = padStr.length;
    number = number.toString();
    return number.length >= len ? number : (padStr + number).slice(-len);
  }
};

module.exports = render.init;
