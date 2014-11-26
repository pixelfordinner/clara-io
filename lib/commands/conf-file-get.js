var _data = {};

var confFileGet = {
  init: function(program, data) {
    _data._parent = data;
    _data._program = program;
    confFileGet._registerCommand(program);
  },

  _registerCommand: function(program) {
    program
      .command('conf-file:get [entry-name]')
        .description('reads conf file entry and displays value')
        .option('-l, --list-all', 'lists all options and values in config file')
        .action(confFileGet._run);
  },

  _run: function(entryName, options) {
    if (typeof entryName !== 'undefined') {
      confFileGet._readOption(entryName);
      return;
    } else if (typeof options.listAll !== 'undefined') {
      confFileGet._listOptions();
    }
  },

  _readOption: function(entryName) {
    if (typeof _data._parent.confFile.obj !== 'object') {
      throw new Error('Configuration file has not been loaded (please check that it exists)');
    }

    if (typeof _data._parent.confFile.obj[entryName] === 'undefined') {
      console.log(_data._parent.output.warning('The property %j was not found within the configuration file.'), entryName);
      return;
    }

    console.log(_data._parent.output.success('%j => %j'), entryName, _data._parent.confFile.obj[entryName]);
  },

  _listOptions: function() {
    if (typeof _data._parent.confFile.obj !== 'object') {
      throw new Error('Configuration file has not been loaded (please check that it exists)');
    }

    for (var key in _data._parent.confFile.obj) {
      console.log(_data._parent.output.success('%j => %j'), key, _data._parent.confFile.obj[key]);
    }
  }
};

module.exports = confFileGet.init;
