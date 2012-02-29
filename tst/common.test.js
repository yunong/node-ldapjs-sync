/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var bunyan = require('bunyan');
var common = require('../lib/common');
var tap = require('tap');
var test = require('tap').test;
var inMemLdap = require('../lib/inMemLdap.js');
var remoteInMemLdap = require('./remoteLdap');

var Replicator = require('../lib/replicator.js');
var ldap = require('ldapjs');
var uuid = require('node-uuid');

///--- Globals

var SUFFIX = 'o=yunong';
var REMOTE_SUFFIX = 'o=yunong';
var REMOTE_PORT = 23364;
var TOTAL_ENTRIES = 5;
var REMOTE_URL = 'ldap://cn=root:secret@127.0.0.1:' + REMOTE_PORT + '/' +
                    SUFFIX + '??sub?(uid=*)';

var LOCAL_PORT = 23456;
var LOCAL_URL = 'ldap://cn=root:secret@localhost:' + LOCAL_PORT;

var ALL_CHANGES_CTRL = new ldap.PersistentSearchControl({
  type: '2.16.840.1.113730.3.4.3',
  value: {
    changeTypes: 15,
    changesOnly: false,
    returnECs: true
  }
});

var suffix = {
  objectClass: ['top', 'organization'],
  o: SUFFIX.split('=')[1],
  uid: uuid()
};

var localBackend;
var localClient = null;
var localLdap;

var remoteBackend;
var remoteClient;
var remoteLdap;

var log = new bunyan({
    name: 'crud-integ-test',
    stream: process.stdout,
    level: 'trace',
    src: true
  });

var REPL_CONTEXT_OPTIONS = {
  log: log,
  remoteUrl: REMOTE_URL,
  localUrl: LOCAL_URL,
  checkpointDn: SUFFIX,
  replSuffix: 'cn=repl, o=yunong'
};

///--- Tests

test('setup-local', function(t) {
  inMemLdap.startServer({suffix: SUFFIX, port: LOCAL_PORT}, function(server) {
    t.ok(server);
    localClient = ldap.createClient({
      url: LOCAL_URL,
      log: log
    });
    localClient.once('connect', function(id) {
      t.ok(id);
      t.ok(localClient);
      console.log('local client connected');
      localClient.bind('cn=root', 'secret', function(err, res) {
        if (err) {
          t.fail(err);
        }
        t.ok(res);
        t.end();
      });
    });
  });
});

test('setup-remote', function(t) {
  remoteInMemLdap.startServer({suffix: REMOTE_SUFFIX, port: REMOTE_PORT},
                        function(server) {
    t.ok(server);
    remoteLdap = server;
    t.end();
  });
});

test('setup-remote-client', function(t) {
  remoteClient = ldap.createClient({
    url: REMOTE_URL,
    log: log
  });

  remoteClient.once('connect', function(id) {
    t.ok(id);
    t.ok(remoteClient);
    console.log('remote client connected');
    t.end();
  });
});

test('setup-replcontext', function(t) {
  REPL_CONTEXT_OPTIONS.localClient = localClient;
  replicator = new Replicator(REPL_CONTEXT_OPTIONS);
  replicator.once('init', function(self) {
    t.ok(replicator);
    t.ok(replicator.checkpoint);
    t.ok(replicator.entryQueue);
    t.ok(replicator.localPool);
    t.ok(replicator.remotePool);
    t.ok(replicator.remoteUrl);
    t.ok(replicator.entryQueue);
    entryQueue = replicator.entryQueue;
    // wait before we end because the search connection is just getting started
    // otherwise the test can't shut down cleanly. Of course this is lame.
    setTimeout(function() {t.end();}, 2000);
  });
});



test('test common writeCheckpoint', function(t) {
  var changelog = {
    object: {
      changenumber: 100
    }
  };

  common.writeCheckpoint(changelog, replicator, function() {
    replicator.checkpoint.get(function(cn) {
        t.equal((100 == cn), true);
        t.end();
    });
  });
});

test('test common changenumber less than checkpoint', function(t) {
  // test changelog smaller than 100
  var changelog = {
    object: {
      changenumber: 99
    }
  };

  common.getCheckpoint(changelog, replicator, function(bail) {
    // we should bail
    t.ok(bail);
    t.end();
  });
});


test('test common changenumber equals checkpoint', function(t) {
  // test changelog smaller than 100
  var changelog = {
    object: {
      changenumber: 100
    }
  };

  common.getCheckpoint(changelog, replicator, function(bail) {
    t.ok(bail);
    t.end();
  });
});


test('test common changenumber greater than checkpoint', function(t) {
  // test changelog smaller than 100
  var changelog = {
    object: {
      changenumber: 500
    }
  };

  common.getCheckpoint(changelog, replicator, function() {
    t.end();
  });
});

test('localsearch setup', function(t) {
  localClient.add('cn=supson, o=yunong', { objectclass: 'executor' },
                  function(err, res) {
    if (err) {
      t.fail(err);
    }
    t.end();
  });
});

test('localsearch exists', function(t) {
  var changelog = {
    object: {
      targetdn: 'cn=supson, o=yunong'
    },
    localDn: 'cn=supson, o=yunong'
  };

  common.localSearch(changelog, replicator, function(bail) {
    // bail should never be set
    if (bail) {
      t.fail();
      t.end();
    }
    t.ok(changelog.localEntry);
    t.equal(changelog.localEntry.dn, 'cn=supson, o=yunong');
    t.end();
  });
});

test('localsearch dne', function(t) {
  var changelog = {
    object: {
      targetdn: 'cn=foobarbazcar, o=yunong'
    },
    localDn: 'cn=foobarbazcar, o=yunong'
  };

  common.localSearch(changelog, replicator, function(bail) {
    // bail should never be set
    if (bail) {
      t.fail();
      t.end();
    }

    // should find nothing
    if (changelog.localEntry) {
      t.fail();
      t.end();
    }
    t.end();
  });
});

test('convertDn', function(t) {
  var cl = {
    object: {
      targetdn: 'targetdn'
    }
  };

  var rc = {
    replSuffix: 'replSuffix',
    log: log
  };

  common.convertDn(cl, rc, function() {
    t.ok(cl.localDn);
    t.equal('targetdn, replSuffix', cl.localDn);
    t.end();
  });
});

tap.tearDown(function() {
  process.exit(tap.output.results.fail);
});

