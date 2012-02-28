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
var ReplContext = require('../lib/replContext');

var inMemLdap = require('./inmemLdap');
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
  url: REMOTE_URL,
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

var replContext;
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
  replContext = new ReplContext(REPL_CONTEXT_OPTIONS);
  replContext.once('init', function(self) {
    t.ok(replContext);
    t.ok(replContext.checkpoint);
    t.ok(replContext.entryQueue);
    t.ok(replContext.localPool);
    t.ok(replContext.remotePool);
    t.ok(replContext.url);
    t.ok(replContext.entryQueue);
    t.ok(replContext.replSuffix);
    entryQueue = replContext.entryQueue;
    // we are technically good to go here after the init event, however, the
    // changelog psearch is asynchronous, so we have to wait here a bit while
    // that finishes. 1.5 seconds ought to do it.
    setTimeout(function() { t.end(); }, 1500);
  });
});

///--- Now add a bunch of stuff


test('bootstrap', function(t) {
  remoteClient.add('o=yunong', {objectclass: 'executor', uid: 'foo'},
                   function(err, res) {

    var protoss = {
      objectclass: 'protoss',
      uid: 'foo'
    };
    remoteClient.add('ou=protoss, o=yunong', protoss, function(err, res) {
      var suffix = ', ou=protoss, o=yunong';
      remoteClient.add('cn=zealot' + suffix, protoss, function(err, res) {});
      remoteClient.add('cn=stalker' + suffix, protoss, function(err, res) {});
      remoteClient.add('cn=sentry' + suffix, protoss, function(err, res) {});
      remoteClient.add('cn=voidray' + suffix, protoss, function(err, res) {});
      remoteClient.add('cn=colossus' + suffix, protoss, function(err, res) {});
    });

    var zerg = {
      objectclass: 'zerg',
      uid: 'foo'
    };
    remoteClient.add('ou=zerg, o=yunong', zerg, function(err, res) {
      var suffix = ', ou=zerg, o=yunong';
      remoteClient.add('cn=zergling' + suffix, zerg, function(err, res) {});
      remoteClient.add('cn=roach' + suffix, zerg, function(err, res) {});
      remoteClient.add('cn=hydralisk' + suffix, zerg, function(err, res) {});
      remoteClient.add('cn=infestor' + suffix, zerg, function(err, res) {
        remoteClient.add('cn=broodlord, cn=infestor' + suffix, zerg,
                         function(err, res) {});
      });
      remoteClient.add('cn=mutalisk' + suffix, zerg, function(err, res) {});
    });
  });

  setTimeout(function() { t.end(); }, 500);
});

test('local replication check', function(t) {
  var gotEntry = 0;
  var entryDns = [];
  localClient.search('o=yunong, ' + REPL_SUFFIX, {scope: 'sub'},
                     function(err, res) {
    if (err) {
      t.fail(err);
      t.end();
    }

    res.on('searchEntry', function(entry) {
      gotEntry++;
      t.ok(entry);
      t.ok(entry.object);
      entryDns.push(entry.object.dn);
    });

    res.on('error', function(err) {
      t.fail(err);
      t.end();
    });

    res.on('end', function(res) {
      console.log(entryDns);
      t.equal(gotEntry, 14);
      t.end();
    });
  });
});

tap.tearDown(function() {
  process.exit(tap.output.results.fail);
});

