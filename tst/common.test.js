/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var common = require('../lib/common');
var test = require('tap').test;
var inMemLdap = require('./inmemLdap.js');
var ReplContext = require('../lib/replContext.js');
var ldap = require('ldapjs');
var log4js = require('log4js');
var uuid = require('node-uuid');

///--- Globals

var SUFFIX = 'o=yunong';
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

  remoteLdap.stdout.on('data', function(data) {
    console.log('remote stdout: ' + data);
  });

  remoteLdap.stderr.on('data', function(data) {
    console.log('remote stderr: ' + data);
  });

  remoteLdap.on('exit', function(code) {
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



test('test common writeCheckpoint', function(t) {
  var changelog = {
    object: {
      changenumber: 100
    }
  };

  common.writeCheckpoint(changelog, replContext, function() {
    replContext.checkpoint.getCheckpoint(function(cn) {
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

  common.getCheckpoint(changelog, replContext, function(bail) {
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

  common.getCheckpoint(changelog, replContext, function(bail) {
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

  common.getCheckpoint(changelog, replContext, function() {
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

  common.localSearch(changelog, replContext, function(bail) {
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

  common.localSearch(changelog, replContext, function(bail) {
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
    log4js: log4js
  };

  common.convertDn(cl, rc, function() {
    t.ok(cl.localDn);
    t.equal('targetdn, replSuffix', cl.localDn);
    t.end();
  });
});

test('tear-down', function(t) {
  if (remoteLdap) {
    setTimeout(function() { remoteLdap.kill(); }, 3000);
  }
  t.end();
});
