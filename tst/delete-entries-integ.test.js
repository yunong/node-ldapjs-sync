var add         = require('../lib/add.js');
var ldap        = require('ldapjs');
var log4js      = require('log4js');
var test        = require('tap').test;
var uuid        = require('node-uuid');
var vm          = require('vm');
var ldapjsRiak  = require('ldapjs-riak');
var ldapjsSync  = require('../lib/index');
var EntryQueue  = require('../lib/entryQueue');
var ReplContext = require('../lib/replContext');

var inMemLdap   = require('./inmemLdap');

///--- Globals
var SUFFIX        = 'o=yunong';
var LOCAL_SUFFIX  = 'o=somewhereovertherainbow';
var REPL_SUFFIX   = 'cn=repl, ' + LOCAL_SUFFIX;
var SOCKET        = '/tmp/.' + uuid();
var REMOTE_PORT   = 23364;
var TOTAL_ENTRIES = 5;
var REMOTE_URL    = 'ldap://cn=root:secret@0.0.0.0:' + REMOTE_PORT + '/' +
                    SUFFIX + '??sub?(uid=*)';

var LOCAL_PORT    = 23456;
var LOCAL_URL     = 'ldap://cn=root:secret@localhost:' + LOCAL_PORT;

var ALL_CHANGES_CTRL = new ldap.PersistentSearchControl({
  type: '2.16.840.1.113730.3.4.3',
  value: {
    changeTypes: 15,
    changesOnly: false,
    returnECs: true
  }
});

var REPL_CONTEXT_OPTIONS = {
  log4js: log4js,
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
    localClient = ldap.createClient({
      url: LOCAL_URL,
      log4js: log4js
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
  var spawn = require('child_process').spawn;
  remoteLdap = spawn('node', ['./tst/remoteInmemldap.js'], {
    cwd: undefined,
    env: process.env,
    setsid: false
  });

  remoteLdap.stdout.on('data', function (data) {
    console.log('remote_stdout: ' + data);
  });

  remoteLdap.stderr.on('data', function (data) {
    console.log('remote_stderr: ' + data);
  });

  remoteLdap.on('exit', function (code) {
    console.log('remote_child process exited with code ' + code);
  });

  t.ok(remoteLdap);
  setTimeout(function() { t.end(); }, 1000);
});

test('setup-remote-client', function(t) {
  remoteClient = ldap.createClient({
    url: REMOTE_URL,
    log4js: log4js
  });

  remoteClient.once('connect', function(id) {
    t.ok(id);
    t.ok(remoteClient);
    console.log('remote client connected');
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
    t.ok(replContext.localClient);
    t.ok(replContext.remoteClient);
    t.ok(replContext.url);
    t.ok(replContext.entryQueue);
    t.ok(replContext.replSuffix);
    entryQueue = replContext.entryQueue;
    // we are technically good to go here after the init event, however, the
    // changelog psearch is asynchronous, so we have to wait here a bit while
    // that finishes. 1.5 seconds ought to do it.
    setTimeout(function(){ t.end(); }, 1500);
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
                         function(err, res){});
      });
      remoteClient.add('cn=mutalisk' + suffix, zerg, function(err, res) {});
    });
  });

  setTimeout(function() { t.end(); }, 2000);
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
        setTimeout(function(){t.end();}, 2000);
      });
    });
  });
});

var localContent = [ { dn: 'o=yunong, cn=repl, o=somewhereovertherainbow',
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
  { dn: 'cn=mothership, ou=protoss, o=yunong, cn=repl, o=somewhereovertherainbow',
    controls: [],
    objectclass: 'protoss' } ];

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

test('tear-down', function(t) {
  if (remoteLdap) {
    // time this out so the loggers will flush
    setTimeout(function() { remoteLdap.kill(); }, 2000);
  }
  t.end();
});