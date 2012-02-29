/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var add = require('../lib/add.js');
var bunyan = require('bunyan');
var ldap = require('ldapjs');
var tap = require('tap');
var test = require('tap').test;
var uuid = require('node-uuid');
var EntryQueue = require('../lib/entryQueue');
var Replicator = require('../lib/replicator');

var inMemLdap = require('../lib/inMemLdap');
var remoteInMemLdap = require('./remoteLdap');

///--- Globals
var SUFFIX = 'o=yunong';
var LOCAL_SUFFIX = 'o=somewhereovertherainbow';
var REMOTE_SUFFIX = 'o=yunong';
var REPL_SUFFIX = 'cn=repl, ' + LOCAL_SUFFIX;
var SOCKET = '/tmp/.' + uuid();
var REMOTE_PORT = 23364;
var TOTAL_ENTRIES = 5;
var REMOTE_URL = 'ldap://cn=root:secret@0.0.0.0:' + REMOTE_PORT + '/' +
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
  checkpointDn: LOCAL_SUFFIX,
  replSuffix: REPL_SUFFIX
};

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


var entryQueue;
var url = ldap.url.parse(REMOTE_URL, true);

var replicator;
///--- Tests

test('setup-local', function(t) {
  inMemLdap.startServer({suffix: LOCAL_SUFFIX, port: LOCAL_PORT},
                        function(server) {
    t.ok(server);
    localLdap = server;
    localClient = ldap.createClient({
      url: LOCAL_URL,
      log: log
    });

    localClient.on('error', function(err) {
      t.fail(err);
      t.end();
    });

    localClient.once('connect', function(id) {
      t.ok(id);
      t.ok(localClient);
      log.info('local client connected');
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

test('setup-local-fixtures', function(t) {
  var entry = {
    objectclass: 'yellowbrickroad'
  };

  localClient.add(LOCAL_SUFFIX, entry, function(err, res) {
    if (err) {
      t.fail(err);
    }
    t.ok(res);
    localClient.add(REPL_SUFFIX, entry, function(err, res) {
      if (err) {
        t.fail(err);
      }
      t.ok(res);
      t.end();
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
    log.info('remote client connected');
    remoteClient.bind('cn=root', 'secret', function(err, res) {
      if (err) {
        t.fail(err);
        t.end();
      }
      t.ok(remoteClient);
      t.end();
    });
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
    t.ok(replicator.replSuffix);
    entryQueue = replicator.entryQueue;
    // we are technically good to go here after the init event, however, the
    // changelog psearch is asynchronous, so we have to wait here a bit while
    // that finishes. 1.5 seconds ought to do it.
    setTimeout(function() { t.end(); }, 1500);
  });
});


///--- Simple CRUD
test('add', function(t) {
  var entry = { objectclass: 'executor', uid: 'foo' };
  remoteClient.add('o=yunong', entry, function(err, res) {
    if (err) {
      t.fail(err);
    }

    entryQueue.on('popped', function(changelog, entryQueue) {
      localClient.search('o=yunong, ' + REPL_SUFFIX, function(err, res) {
        log.info('searching locally');
        if (err) {
          t.fail(err);
          t.end();
        }
        var gotEntry;
        res.on('searchEntry', function(entry) {
          t.ok(entry);
          t.ok(entry instanceof ldap.SearchEntry);
          t.ok(entry.dn.toString());
          t.ok(entry.attributes);
          t.ok(entry.attributes.length);
          t.ok(entry.object);
          t.equal(entry.dn.toString(), 'o=yunong, ' + REPL_SUFFIX);
          gotEntry = true;
        });

        res.on('error', function(err) {
          t.fail(err);
          t.end();
        });

        res.on('end', function(res) {
          t.ok(gotEntry);
          t.end();
        });
      });
    });
  });
});

test('modify', function(t) {
  var change = {
    type: 'add',
    modification: {
      'pets': ['honey badger', 'bear']
    }
  };

  remoteClient.modify('o=yunong', change, function(err, res) {
    if (err) {
      t.fail(err);
      t.end();
    }
    entryQueue.on('popped', function(changelog, entryQueue) {
      localClient.search('o=yunong, ' + REPL_SUFFIX,
                         function(err, res) {
        if (err) {
          t.fail(err);
          t.end();
        }

        res.on('searchEntry', function(entry) {
          t.ok(entry);
          t.ok(entry instanceof ldap.SearchEntry);
          t.ok(entry.dn.toString());
          t.ok(entry.attributes);
          t.ok(entry.attributes.length);
          t.ok(entry.object);
          t.equal(entry.dn.toString(), 'o=yunong, ' + REPL_SUFFIX);
          t.equal(entry.object.pets[0], 'honey badger');
          t.equal(entry.object.pets[1], 'bear');
        });
        res.on('error', function(err) {
          t.fail(err);
        });
        res.on('end', function(res) {
          t.end();
        });
      });
    });
  });
});

test('delete', function(t) {
  remoteClient.del('o=yunong', function(err, res) {
    if (err) {
      t.fail(err);
      t.end();
    }
    entryQueue.on('popped', function(changelog, entryQueue) {
      localClient.search('o=yunong, ' + REPL_SUFFIX,
                         function(err, res) {
        if (err) {
          t.fail(err);
          t.end();
        }
        res.on('searchEntry', function(entry) {
          t.fail('deleted entry should not exist locally');
        });
        res.on('error', function(err) {
          t.equal(err.code, 32);
          t.end();
        });
        res.on('end', function(res) {
          t.end();
        });
      });
    });
  });
});

tap.tearDown(function() {
  process.exit(tap.output.results.fail);
});
