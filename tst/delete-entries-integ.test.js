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
    t.ok(replicator.url);
    t.ok(replicator.entryQueue);
    t.ok(replicator.replSuffix);
    entryQueue = replicator.entryQueue;
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
      remoteClient.add('cn=colossus' + suffix, protoss, function(err, res) {});
    });

    var zerg = {
      objectclass: 'zerg',
      uid: 'foo'
    };
    remoteClient.add('ou=zerg, o=yunong', zerg, function(err, res) {
      var suffix = ', ou=zerg, o=yunong';
      zerg.attack = 'melee';
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


/**
 * The entry exists locally and matches the replication filter.
 * cn=broodlord deleted locally
 */
test('delete condition 1', function(t) {
  var dn = 'cn=broodlord, cn=infestor, ou=zerg, o=yunong';
  remoteClient.del(dn, function(err, res) {
    if (err) {
      t.fail(err);
      t.end();
    }

    t.end();
  });
});

/**
 * The entry doesn't exist locally.
 * cn=archon deleted locally
 */
test('delete condition 2', function(t) {
  // create a new remote entry that doesn't match the filter
  var dn = 'cn=archon, ou=protoss, o=yunong';
  var entry = {
    objectclass: 'protoss' // no uid field
  };

  remoteClient.add(dn, entry, function(err, res) {
    if (err) {
      t.fail(err);
      t.end();
    }
    // delete this entry
    remoteClient.del(dn, function(err, res) {
      if (err) {
        t.fail(err);
        t.end();
      }
      t.end();
    });
  });
});

/**
 * The entry exists locally and doesn't match the replication filter.
 * local server should still have cn=mothership
 */
test('delete condition 3', function(t) {
  var dn = 'cn=mothership, ou=protoss, o=yunong';
  var entry = {
    objectclass: 'protoss'
  };

  // add locally first
  localClient.add(dn + ', ' + REPL_SUFFIX, entry, function(err, res) {
    if (err) {
      t.fail(err);
      t.end();
    }

    // add remotely
    remoteClient.add(dn, entry, function(err, res) {
      if (err) {
        t.fail(err);
        t.end();
      }

      // delete remotely
      remoteClient.del(dn, function(err, res) {
        if (err) {
          t.fail(err);
          t.end();
        }
        setTimeout(function() {t.end();}, 500);
      });
    });
  });
});

var localContent = [{ dn: 'o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    objectclass: 'executor',
    uid: 'foo' },
  { dn: 'ou=protoss, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    objectclass: 'protoss',
    uid: 'foo' },
  { dn: 'ou=zerg, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    objectclass: 'zerg',
    uid: 'foo' },
  { dn: 'cn=zealot, ou=protoss, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    objectclass: 'protoss',
    uid: 'foo' },
  { dn: 'cn=stalker, ou=protoss, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    objectclass: 'protoss',
    uid: 'foo' },
  { dn: 'cn=colossus, ou=protoss, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    objectclass: 'protoss',
    uid: 'foo' },
  { dn: 'cn=zergling, ou=zerg, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    attack: 'melee',
    objectclass: 'zerg',
    uid: 'foo' },
  { dn: 'cn=roach, ou=zerg, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    attack: 'melee',
    objectclass: 'zerg',
    uid: 'foo' },
  { dn: 'cn=hydralisk, ou=zerg, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    attack: 'melee',
    objectclass: 'zerg',
    uid: 'foo' },
  { dn: 'cn=infestor, ou=zerg, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    attack: 'melee',
    objectclass: 'zerg',
    uid: 'foo' },
  { dn: 'cn=mutalisk, ou=zerg, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    attack: 'melee',
    objectclass: 'zerg',
    uid: 'foo' },
  { dn: 'cn=mothership, ou=protoss, o=yunong, cn=repl, ' +
         'o=somewhereovertherainbow',
    controls: [],
    objectclass: 'protoss' }];

test('local replication check', function(t) {
  localContent.sort();
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
      entryDns.push(entry.object);
    });

    res.on('error', function(err) {
      t.fail(err);
      t.end();
    });

    res.on('end', function(res) {
      t.equal(entryDns.length, 12);
      entryDns.sort();
      entryDns.forEach(function(element, index) {
        var found = JSON.stringify(element);
        var expected = JSON.stringify(localContent[index]);
        t.equal(found, expected);
      });
      t.end();
    });
  });
});

tap.tearDown(function() {
  process.exit(tap.output.results.fail);
});
