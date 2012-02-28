/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var ReplContext = require('../lib/replContext');

var bunyan = require('bunyan');
var fs = require('fs');
var nopt = require('nopt');
var path = require('path');

var log = new bunyan({
    name: 'ldap-replication',
    stream: process.stdout
});

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

    if (CONFIG.logLevel) {
      log.level(CONFIG.logLevel);
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
      log.level('trace');
    } else {
      log.level('debug');
    }
  }

  // check that we have all parameters
  if (CONFIG.local_url && CONFIG.remote_url && CONFIG.replication_dn &&
      CONFIG.checkpoint_dn) {
    if (CONFIG.localPoolCfg) {
      CONFIG.localPoolCfg.log = log;
    }
    if (CONFIG.remotePoolCfg) {
      CONFIG.remotePoolCfg.log = log;
    }
    log.debug('config processed: %j', CONFIG);

  } else {
    console.fatal('missing configuration arguments, exiting');
    process.exit(1);
  }
}

// Mainline
log.level('info');
processConfig();

var REPL_CONFIG = {
  log: log,
  url: CONFIG.remote_url,
  localUrl: CONFIG.local_url,
  checkpointDn: CONFIG.checkpoint_dn,
  replSuffix: CONFIG.replication_dn,
  localPoolCfg: CONFIG.local_pool,
  remotePoolCfg: CONFIG.remote_pool
};

var replContext = new ReplContext(REPL_CONFIG);

replContext.once('init', function(self) {
  log.info('ldap replication successfully initiated');
});
