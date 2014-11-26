var fs = require('fs'),
    path = require('path'),
    util = require('util');

var _data = {
  programOptions: [
    'user',
    'key'
  ]
};

var confFileUnset = {
  init: function(program, data) {
    _data._parent = data;
    confFileUnset._registerCommand(program);
  },

  _registerCommand: function(program) {
    program
      .command('conf-file:unset <entry-name>')
        .description('unsets a config file entry')
        .action(confFileUnset._run);
  },

  _run: function(entryName) {
    confFileUnset._checkConfFile();
    confFileUnset._unsetEntry(entryName);
    confFileUnset._saveConfFile();
  },

  _checkConfFile: function() {
    if (fs.existsSync(_data._parent.confFile.path) === false) {
      throw new Error('Config file does not exist');
    }

    if (typeof _data._parent.confFile.obj !== 'object') {
      throw new Error('Config file could not be loaded');
    }
  },

  _unsetEntry: function(entryName) {
      console.log(_data._parent.output.info('Unsetting entry %j'), entryName);
      if (typeof _data._parent.confFile.obj === 'undefined' || typeof _data._parent.confFile.obj[entryName] === 'undefined') {
        console.log(_data._parent.output.warning('Entry %j not found in config file'), entryName);
        return;
      }
      delete _data._parent.confFile.obj[entryName];
      console.log(_data._parent.output.success('Entry %j removed from config file'), entryName);
  },

  _saveConfFile: function() {
    data = JSON.stringify(_data._parent.confFile.obj, null, 2);
    fs.writeFileSync(_data._parent.confFile.path, data);
    console.log(_data._parent.output.success('Config file saved.'));
  }
};

module.exports = confFileUnset.init;
