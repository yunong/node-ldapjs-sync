/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var ReplContext = require('../lib/replContext');
var fs = require('fs');
var log4js = require('log4js');
var nopt = require('nopt');
var path = require('path');

var log = log4js.getLogger('main');

var opts = {
  'local_url': nopt.typeDefs.url,
  'remote_url': nopt.typeDefs.url,
  'replication_dn': String,
  'checkpoint_dn': String,
  'debug': Number,
  'file': nopt.typeDefs.path,
  'help': Boolean
};

var shortOpts = {
  'l': ['--local_url'],
  'r': ['--remote_url'],
  'p': ['--replication_dn'],
  'c': ['--checkpoint_dn'],
  'd': ['--debug'],
  'f': ['--config_file'],
  'h': ['--help']
};

var CONFIG = null;

function usage(code) {
  var msg = 'usage: ' + path.basename(process.argv[1]) + '[-f config_file]';

  if (code === 0) {
    console.log(msg);
  } else {
    console.error(msg);
  }

  process.exit(code);
}

function processConfig() {
  var parsed = nopt(opts, shortOpts, process.argv, 2);

  if (parsed.help) {
    usage(0);
  }

  try {
    var file = parsed.file || './cfg/config.json';

    CONFIG = JSON.parse(fs.readFileSync(file, 'utf8'));

    if (CONFIG.loggers) {
      log4js.configure(CONFIG.loggers, {});
    }
    if (CONFIG.logLevel) {
      log4js.setGlobalLogLevel(CONFIG.logLevel);
    }
  } catch (e) {
    console.error('Unable to parse configuration file: ' + e.message);
    process.exit(1);
  }

  if (parsed.local_url) {
    CONFIG.local_url = parsed.local_url;
  }

  if (parsed.remote_url) {
    CONFIG.remote_url = parsed.remote_url;
  }

  if (parsed.replication_dn) {
    CONFIG.replication_dn = parsed.replication_dn;
  }

  if (parsed.checkpoint_dn) {
    CONFIG.checkpoint_dn = parsed.checkpoint_dn;
  }

  if (parsed.debug) {
    if (parsed.debug > 1) {
      log4js.setGlobalLogLevel('TRACE');
    } else {
      log4js.setGlobalLogLevel('DEBUG');
    }
  }

  // check that we have all parameters
  if (CONFIG.local_url && CONFIG.remote_url && CONFIG.replication_dn &&
      CONFIG.checkpoint_dn) {
    log.debug('config processed: %j', CONFIG);
  } else {
    console.fatal('missing configuration arguments, exiting');
    process.exit(1);
  }
}

// Mainline
log4js.setGlobalLogLevel('INFO');
processConfig();

var REPL_CONFIG = {
  log4js: log4js,
  url: CONFIG.remote_url,
  localUrl: CONFIG.local_url,
  checkpointDn: CONFIG.checkpoint_dn,
  replSuffix: CONFIG.replication_dn,
  localClientCfg: CONFIG.local_client,
  remoteClientCfg: CONFIG.remote_client
};

var replContext = new ReplContext(REPL_CONFIG);

replContext.once('init', function(self) {
  log.info('ldap replication successfully initiated');
});
