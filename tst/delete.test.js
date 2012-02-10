var add         = require('../lib/add');
var common      = require('../lib/common');
var del         = require('../lib/delete');
var test          = require('tap').test;
var inMemLdap     = require('./inmemLdap.js');
var ReplContext   = require('../lib/replContext.js');
var ldap          = require('ldapjs');
var log4js        = require('log4js');
var uuid          = require('node-uuid');
var ldapjsRiak    = require('ldapjs-riak');
var ldapjsSync    = require('../lib/index');

///--- Globals

var SUFFIX        = 'o=yunong';
var REMOTE_PORT   = 23364;
var TOTAL_ENTRIES = 5;
var REMOTE_URL    = 'ldap://cn=root:secret@127.0.0.1:' + REMOTE_PORT + '/' +
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

var REPL_CONTEXT_OPTIONS = {
  log4js: log4js,
  url: REMOTE_URL,
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

test('setup-remote', function(t) {
  var spawn = require('child_process').spawn;
  remoteLdap = spawn('node', ['./tst/remoteInmemldap.js'], {
    cwd: undefined,
    env: process.env,
    setsid: false
  });

  remoteLdap.stdout.on('data', function (data) {
    console.log('remote stdout: ' + data);
  });

  remoteLdap.stderr.on('data', function (data) {
    console.log('remote stderr: ' + data);
  });

  remoteLdap.on('exit', function (code) {
    console.log('remote child process exited with code ' + code);
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
    entryQueue = replContext.entryQueue;
    // wait before we end because the search connection is just getting started
    // otherwise the test can't shut down cleanly
    setTimeout(function() {t.end();}, 2000);
  });
});

test('add entry to datastore', function(t) {
  var changelog = {
    object: {
      dn: 'changenumber=1326414273440, cn=changelog',
      controls: [],
      targetdn: 'o=yunong',
      changetime: '2012-01-13T00:24:33Z',
      changenumber: '1326414273442',
      changetype: 'add',
      changes: {
        objectclass: [ 'organizationalUnit' ],
        ou: [ 'users' ],
        uid: 'foo'
      },
      objectclass: 'changeLogEntry'
    },
    remoteEntry: {
      objectclass: [ 'organizationalUnit' ],
      ou: [ 'users' ],
      uid: 'foo'
    }
  };

  add.add(changelog, replContext, function() {
    replContext.localClient.search(changelog.object.targetdn,
                                   function(err, res) {
      t.ok(res);
      t.end();
      res.on('searchEntry', function(entry) {
        t.ok(entry);
        t.ok(entry.object);
        t.equal(entry.object.dn, changelog.object.targetdn);
        t.equal(entry.object.objectclass, changelog.remoteEntry.uid);
        storedLocalEntry = entry;
      });

      res.on('end', function(res) {
        t.end();
      });
    });
  });
});

test('delete local search entry dne', function(t) {
  var changelog = {
    object: {
      dn: 'changenumber=1326414273440, cn=changelog',
      controls: [],
      targetdn: 'cn=foo, o=yunong',
      changetime: '2012-01-13T00:24:33Z',
      changenumber: '1326414273443',
      changetype: 'delete',
      objectclass: 'changeLogEntry'
    }
  };

  del.localSearch(changelog, replContext, function(bail) {
    if (bail) {
      t.end();
    } else {
      t.fail();
    }
  });
});

test('delete local search entry exists', function(t) {
  var changelog = {
    object: {
      dn: 'changenumber=1326414273440, cn=changelog',
      controls: [],
      targetdn: 'o=yunong',
      changetime: '2012-01-13T00:24:33Z',
      changenumber: '1326414273443',
      changetype: 'delete',
      objectclass: 'changeLogEntry'
    }
  };

  del.localSearch(changelog, replContext, function(bail) {
    if (bail) {
      t.fail();
    } else {
      t.ok(changelog.localEntry);
      t.ok(changelog.localEntry.object);
      t.equal(changelog.localEntry.object.dn, changelog.object.targetdn);
      t.end();
    }
  });
});

test('determineDelete entry matches', function(t) {
  localClient.add('cn=supson, o=yunong', {uid: uuid()}, function(err, res) {
    if (err) {
      t.fail(err);
      t.end();
    }

    var changelog = {
      object: {
        dn: 'changenumber=1326414273440, cn=changelog',
        controls: [],
        targetdn: 'cn=supson, o=yunong',
        changetime: '2012-01-13T00:24:33Z',
        changenumber: '1326414273443',
        changetype: 'delete',
        objectclass: 'changeLogEntry'
      },
      localEntry: {
        dn: 'cn=supson, o=yunong',
        object: {
          uid: uuid()
        }
      }
    };

    del.determineDelete(changelog, replContext, function() {
      var opts = {
        filter: '(uid=*)'
      };
      // entry should be deleted
      replContext.localClient.search('cn=supson, o=yunong', opts,
                                      function(err, res) {
        var retreived = false;
        if (err) {
          t.fail(err);
          t.end();
        }
        res.on('searchEntry', function(entry) {
          t.fail(entry.object);
          t.end();
        });

        res.on('error', function(err) {
          t.equal(err.name, 'NoSuchObjectError');
          t.end();
        });
      });
    });
  });
});

test('determineDelete entry does not match', function(t) {
  localClient.add('cn=supsons, o=yunong', {l: 'foo'}, function(err, res) {
    if (err) {
      t.fail(err);
      t.end();
    }

    var changelog = {
      object: {
        dn: 'changenumber=1326414273440, cn=changelog',
        controls: [],
        targetdn: 'cn=supsons, o=yunong',
        changetime: '2012-01-13T00:24:33Z',
        changenumber: '1326414273443',
        changetype: 'delete',
        objectclass: 'changeLogEntry'
      },
      localEntry: {
        dn: 'cn=supsons, o=yunong',
        object: {}
      }
    };

    del.determineDelete(changelog, replContext, function() {
      var opts = {
        filter: '(l=*)'
      };
      // entry should not be deleted as it lacks the uid attr
      replContext.localClient.search('cn=supsons, o=yunong', opts,
                                      function(err, res) {
        var retrieved = false;

        if (err) {
          t.fail(err);
          t.end();
        }

        res.on('searchEntry', function(entry) {
          t.ok(entry);
          t.ok(entry.object);
          t.equal(entry.object.dn, 'cn=supsons, o=yunong');
          retrieved = true;
        });

        res.on('error', function(err) {
          t.fail(err);
          t.end();
        });

        res.on('end', function(res) {
          t.ok(res);
          t.ok(res instanceof ldap.SearchResponse);
          t.equal(res.status, 0);
          t.equal(retrieved, true);
          t.end();
        });
      });
    });
  });
});

test('tear-down', function(t) {
  if (remoteLdap) {
    setTimeout(function() { remoteLdap.kill(); }, 3000);
  }
  t.end();
});