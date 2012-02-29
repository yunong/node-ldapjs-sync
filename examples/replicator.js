/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var bunyan = require('bunyan');
var Replicator = require('ldapjs-sync');

var log = new bunyan({
  name: 'ldap-replication',
  stream: process.stdout
});

// replicator configs
var options = {
  log: log,
  remoteUrl: 'ldap://cn=root:secret@0.0.0.0:23456/o=kansas??sub?(uid=*)',
  localUrl: 'ldap://cn=root:secret@0.0.0.0:23455',
  checkpointDn: 'o=oz',
  replSuffix: 'o=oz'
};

var replicator = new Replicator(options);

replicator.on('init', function() {
  log.info('replicator has started.');
});
