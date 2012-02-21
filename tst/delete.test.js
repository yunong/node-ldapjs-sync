/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var add = require('../lib/add');
var common = require('../lib/common');
var del = require('../lib/delete');
var ldap = require('ldapjs');
var log4js = require('log4js');
var test = require('tap').test;
var uuid = require('node-uuid');
var EntryQueue = require('../lib/entryQueue');
var ReplContext = require('../lib/replContext');

var inMemLdap = require('./inmemLdap');

///--- Globals
var SUFFIX = 'o=yunong';
var LOCAL_SUFFIX = 'o=somewhereovertherainbow';
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

  remoteLdap.stdout.on('data', function(data) {
    console.log('remote_stdout: ' + data);
  });

  remoteLdap.stderr.on('data', function(data) {
    console.log('remote_stderr: ' + data);
  });

  remoteLdap.on('exit', function(code) {
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
    setTimeout(function() { t.end(); }, 1500);
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
        objectclass: ['organizationalUnit'],
        ou: ['users'],
        uid: 'foo'
      },
      objectclass: 'changeLogEntry'
    },
    remoteEntry: {
      objectclass: 'organizationalUnit',
      ou: 'users',
      uid: 'foo'
    },
    localDn: 'o=yunong, ' + REPL_SUFFIX
  };

  add.add(changelog, replContext, function() {
    replContext.localClient.search(changelog.localDn,
                                   function(err, res) {
      t.ok(res);
      t.end();
      res.on('searchEntry', function(entry) {
        t.ok(entry);
        t.ok(entry.object);
        // t.equal(entry.object.dn, changelog.object.targetdn);
        // t.equal(entry.object.objectclass, changelog.remoteEntry.uid);
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
    },
    localDn: 'cn=foo, o=yunong, ' + REPL_SUFFIX
  };

  del.localSearch(changelog, replContext, function(bail) {
    if (bail) {
      t.end();
    } else {
      t.fail();
      t.end();
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
    },
    localDn: 'o=yunong, ' + REPL_SUFFIX
  };

  del.localSearch(changelog, replContext, function(bail) {
    if (bail) {
      t.fail();
    } else {
      t.ok(changelog.localEntry);
      t.ok(changelog.localEntry.object);
      t.equal(changelog.localEntry.object.dn, changelog.localDn);
      t.end();
    }
  });
});

test('determineDelete entry matches', function(t) {
  localClient.add('cn=supson, o=yunong, ' + REPL_SUFFIX, {uid: uuid()},
                  function(err, res) {
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
        dn: 'cn=supson, o=yunong, ' + REPL_SUFFIX,
        object: {
          uid: uuid()
        }
      },
      localDn: 'cn=supson, o=yunong, ' + REPL_SUFFIX
    };

    del.determineDelete(changelog, replContext, function() {
      var opts = {
        filter: '(uid=*)'
      };
      // entry should be deleted
      replContext.localClient.search(changelog.localDn, opts,
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
  localClient.add('cn=supsons, o=yunong, ' + REPL_SUFFIX, {l: 'foo'},
                  function(err, res) {
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
        dn: 'cn=supsons, o=yunong, ' + REPL_SUFFIX,
        object: {}
      },
      localDn: 'cn=supsons, o=yunong, ' + REPL_SUFFIX
    };

    del.determineDelete(changelog, replContext, function() {
      var opts = {
        filter: '(l=*)'
      };
      // entry should not be deleted as it lacks the uid attr
      replContext.localClient.search(changelog.localDn, opts,
                                     function(err, res) {
        var retrieved = false;

        if (err) {
          t.fail(err);
          t.end();
        }

        res.on('searchEntry', function(entry) {
          t.ok(entry);
          t.ok(entry.object);
          t.equal(entry.object.dn, 'cn=supsons, o=yunong, ' + REPL_SUFFIX);
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
