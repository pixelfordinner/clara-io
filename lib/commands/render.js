var fs = require('fs'),
    path = require('path'),
    querystring = require('querystring'),
    fa = require('fa'),
    request = require('superagent'),
    progress = require('progress'),
    jsel = require('JSONSelect'),
    Sequence = require('sequence').Sequence;

var _data = {
  params: {},
  jobs: {},
  lastJobsLoad: 0,
  programOptions: [
    'sceneName',
    'pass',
    'width',
    'height',
    'startFrame',
    'endFrame'
  ],
  threads: 3,
  format: 'png'
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
    var sequence = Sequence.create();

    render._loadOptions(options);
    render._checkReqParams(sceneUUID, options);

    sequence
        .then(function(next) {
            render._loadJobs(sceneUUID, next);
        })
        .then(function(next) {
            render._renderScene(sceneUUID, next);
        });
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
      throw Error('sceneUUID parameter (string) is required ');
    }

    _data.programOptions.forEach(function (programOption) {
      if (typeof _data.params[programOption] === 'undefined') {
        throw Error('Missing required option ' + programOption);
      }
    });

    if (typeof _data._parent.confFile.obj.user !== 'string' ||
        typeof _data._parent.confFile.obj.key !== 'string') {
      throw Error('Username or API Key not found in config file.');
    }

    if (typeof options.threads !== 'undefined') {
      _data.threads = parseInt(options.threads) > 0 ? parseInt(options.threads) : _data.threads;
    }
  },

  _loadJobs: function(sceneUUID, next) {
    var url = _data._parent.api.baseUrl + 'scenes/' + sceneUUID + '/jobs',
        now = new Date().getTime();

    if (now - _data.lastJobsLoad < 15000) {
           console.log(_data._parent.output.warning('> Jobs object is fresh enough.'));
           next();
           return;
    }

    console.log('> Fetching jobs.');
    request
        .get(url)
        .auth(_data._parent.confFile.obj.user, _data._parent.confFile.obj.key)
        .accept('json')
        .end(function(err, res) {
            if (err) {
                console.log(_data._parent.output.warning('Error while fetching jobs: ' + err + ' (Retrying in 5s)'));
                setTimeout(function() {
                    render._loadJobs(sceneUUID, next);
                }, 5000);
                return;
            }

            if (res.body.length <= 0 || res.type.indexOf('json') === -1) {
                console.log(_data._parent.output.warning('> Empty/Bad response received for jobs.'));
            } else {
                _data.jobs = res.body;
                _data.lastJobsLoad = new Date().getTime();
                console.log(_data._parent.output.success('> Jobs received'));
            }

            next();
        });
  },

  _renderScene: function(sceneUUID, next) {
    var startFrame = parseInt(_data.params.startFrame),
        endFrame = parseInt(_data.params.endFrame);

    if ((isNaN(startFrame) || isNaN(endFrame)) === true) {
        throw Error('Both startFrame and endFrame must be numbers.');
    }

    if (endFrame < startFrame) {
        throw Error('endFrame cannot be smaller than startFrame');
    }

    var frameCount = endFrame - startFrame,
        i = startFrame;

    var frames = Array.apply(null, new Array(frameCount + 1)).map(function () { return i++; });

    console.log('> Fetching %d frame(s) using %d thread(s).', frameCount, _data.threads);

    fa.concurrent(_data.threads).continue().each(frames, function(frame, callback) {
        render._fetchFrame(sceneUUID, frame, callback);
    }, function (err, res) {
        if (err) {
            throw Error(err);
        }
        console.log(_data._parent.output.success('> Fetching process complete.'));
        next();
    });
  },

  _fetchFrame: function(sceneUUID, frame, callback) {
    var paddedFrame = render._padString(frame, '0000'),
        filename = _data.params.sceneName + '_' + _data.params.width + 'x' + _data.params.height + '_' + paddedFrame + '.' + _data.format;

    if (render._isFileValid(filename) === true) {
        console.log(_data._parent.output.info('[#' + paddedFrame + '] Skipped (file already exists).'));
        callback();
        return;
    }

    var jobsMatches = render._getJobsMatches(sceneUUID, frame),
        jobsDone = render._getJobsDone(jobsMatches),
        jobsPending = render._getJobsPending(jobsMatches);

    if (jobsDone.length <= 0 && jobsPending.length > 0) {
        console.log(_data._parent.output.warning('[#' + paddedFrame + '] Rendering pending (Retry in 30s).'));
        setTimeout(function() {
            var sequence = Sequence.create();

            sequence
                .then(function(next) {
                    render._loadJobs(sceneUUID, next);
                })
                .then(function(next) {
                    render._fetchFrame(sceneUUID, frame, callback);
                });
        }, 30000);
        return;
    }

    var fetcher = jobsDone.length > 0 ? render._fromJob : render._fromRender;

    return fetcher(sceneUUID, frame, filename, jobsDone, callback);
  },


  _isFileValid: function(filename) {
    return !fs.existsSync(filename) ? false : fs.statSync(filename).size > 0;
  },

  _getJobsMatches: function(sceneUUID, frame) {
    var candidates = jsel.match(':has(.data > .time:expr(x=' + frame + '))', _data.jobs),
        matches = [];

    candidates.forEach(function(candidate) {

        if (typeof candidate.data === 'object' &&
            typeof candidate.files === 'object' &&
            candidate.data.width == _data.params.width &&
            candidate.data.height == _data.params.height) {
                matches.push(candidate);
        }
    });

    return matches;
  },

  _getJobsPending: function(candidates) {
    var matches = [];

    candidates.forEach(function(candidate) {
        if (candidate.status == 'working') {
            matches.push(candidate);
        }
    });

    return matches;
  },

  _getJobsDone: function(candidates) {
    var matches = [];

    candidates.forEach(function(candidate) {
        if (candidate.status == 'ok') {
            candidate.files.forEach(function(file) {
                if (typeof file === 'object' &&
                    typeof file.hash === 'string' &&
                    file.type == 'image/' + _data.format) {
                        matches.push(candidate);
                }
            });
        }
    });

    return matches;
  },

  _fromJob: function(sceneUUID, frame, filename, jobsDone, callback) {
    var paddedFrame = render._padString(frame, '0000'),
        url = _data._parent.api.resourcesUrl + jobsDone[0].files[0].hash;

    console.log(_data._parent.output.info('[#' + render._padString(frame, '0000') + '] Fetching from finished jobs.'));

    request
        .get(url)
        .accept(_data.format)
        .auth(_data._parent.confFile.obj.user, _data._parent.confFile.obj.key)
        .end(function(err, res) {
            var retry = function() {
                console.log(_data._parent.output.info('[#' + paddedFrame + '] Retrying in 10s.'));
                setTimeout(function() { render._retry(sceneUUID, frame, callback); }, 10000);
            };
            render._handleRequestResponse(err, res, paddedFrame, filename, retry, callback);
        });

    return;
  },

  _fromRender: function(sceneUUID, frame, filename, jobsDone, callback) {
    var paddedFrame = render._padString(frame, '0000'),
        url = _data._parent.api.baseUrl + 'scenes/' + sceneUUID + '/render';

    console.log(_data._parent.output.info('[#' + paddedFrame + '] Requesting render.'));

    request
        .get(url)
        .accept(_data.format)
        .auth(_data._parent.confFile.obj.user, _data._parent.confFile.obj.key)
        .query({
            time: frame,
            pass: _data.params.pass,
            width: _data.params.width,
            height: _data.params.height
        })
        .end(function(err, res) {
            var retry = function() {
                console.log(_data._parent.output.info('[#' + paddedFrame + '] Retrying in 10s.'));
                setTimeout(function() { render._retry(sceneUUID, frame, callback); }, 10000);
            };
            render._handleRequestResponse(err, res, paddedFrame, filename, retry, callback);
        });
  },

  _handleRequestResponse: function(err, res, paddedFrame, filename, retry, callback) {
    if (err) {
        console.log(_data._parent.output.error('[#' + paddedFrame + '] Error: ' + err + ' (Skipping)'));
        callback();
    }

    if (res.body.length <= 0 || res.type.indexOf('image') === -1) {

        console.log(_data._parent.output.error('[#' + paddedFrame + '] Empty response received.'));
        retry();
        return;

    } else {

        if (res.body.length !== parseInt(res.header['content-length'])) {
            console.log(_data._parent.output.error('[#' + paddedFrame + '] Partial Transfer!'));
            retry();
            return;
        }

        fs.writeFile(filename, res.body, function(err) {
            if (err) {
                console.log(_data._parent.output.error('[#' + paddedFrame + '] Unable to write file. (' + err + ')'));
            }
        });

        console.log(_data._parent.output.success('[#' + paddedFrame + '] File downloaded.'));

        callback();
    }
  },

  _retry: function(sceneUUID, frame, callback) {
    var sequence = Sequence.create();

    sequence
        .then(function(next) {
            render._loadJobs(sceneUUID, next);
        })
        .then(function(next) {
            render._fetchFrame(sceneUUID, frame, callback);
        });
  },

  _padString: function(number, padStr) {
    var len = padStr.length;
    number = number.toString();
    return number.length >= len ? number : (padStr + number).slice(-len);
  }
};

module.exports = render.init;
