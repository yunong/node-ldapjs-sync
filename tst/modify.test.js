var mock        = require('nodemock');
var modify      = require('../lib/modify');
var common      = require('../lib/common');
var ldap        = require('ldapjs');
var log4js      = require('log4js');
var test        = require('tap').test;
var uuid        = require('node-uuid');
var ldapjsRiak  = require('ldapjs-riak');
var ldapjsSync  = require('../lib/index');
var EntryQueue  = require('../lib/entryQueue');
var ReplContext = require('../lib/replContext');

///--- Globals
var REMOTE_URL  ='ldap://127.0.0.1:' + 23444 + '/' +
                 'o=yunong' + '??sub?(objectclass=*)';
var SUFFIX        = 'o=yunong';
var LOCAL_SUFFIX  = 'o=somewhereovertherainbow';
var REPL_SUFFIX   = 'cn=repl, ' + LOCAL_SUFFIX;
var SOCKET        = '/tmp/.' + uuid();
var REMOTE_PORT   = 23364;
var TOTAL_ENTRIES = 5;
var REMOTE_URL    ='ldap://127.0.0.1:' + REMOTE_PORT + '/' +
                    SUFFIX + '??sub?(uid=*)';

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
  checkpointBucket: uuid()
};

var suffix = {
  objectClass: ['top', 'organization'],
  o: SUFFIX.split('=')[1],
  uid: uuid()
};

var localBackend;
var localClient = {};
var localLdap;

var remoteBackend;
var remoteClient;
var remoteLdap;


var entryQueue;
var url = ldap.url.parse(REMOTE_URL, true);

var replContext;
///--- Tests

test('setup-replcontext', function(t) {
  replContext = {
    url: ldap.url.parse(REMOTE_URL, true),
    log: log4js.getLogger('modify-test'),
    log4js: log4js,
    replSuffix: REPL_SUFFIX
  };

  t.ok(replContext.url);
  t.end();
});


/**
 * Both modified and unmodified entries match the filter
 */
test('determine modify condition 1', function(t) {
  var changelog = {
    object: {
      targetdn: 'cn=foo, o=yunong',
      entry: {
        objectclass: [ 'user' ],
        uid: uuid(),
        pets: ['honey badger', 'bear']
      },
      changes: [{
        operation: 'add',
        modification:{
          type: 'pets',
          vals: ['honey badger', 'bear']
        }
      }]
    },
    localEntry: {
      object: {
        objectclass: [ 'user' ],
        uid: uuid()
      }
    },
    localDn: 'cn=foo, o=yunong'
  };

  // determine modify should call mod
  replContext.localClient = mock.mock('modify').takes(
    changelog.object.targetdn, changelog.object.changes,
    function(){}).calls(2, [null, {}]);

  modify.determineModify(changelog, replContext, function() {
    t.equal(replContext.localClient.assert(), true);
    t.end();
  });
});

/**
 * Neither entry matches the filter
 */
test('determine modify condition 2', function(t) {
  // no uuid
  var changelog = {
    object: {
      targetdn: 'cn=foo, o=yunong',
      entry: {
        objectclass: [ 'user' ],
        pets: ['honey badger', 'bear']
      },
      changes: [{
        operation: 'add',
        modification:{
          type: 'pets',
          vals: ['honey badger', 'bear']
        }
      }]
    },
    localEntry: {
      object: {
        objectclass: [ 'user' ]
      }
    },
    localDn: 'cn=foo, o=yunong'
  };

  // determine modify should not call mod
  replContext.localClient = mock.mock('modify').takes(
    changelog.object.targetdn, changelog.object.changes,
    function(){}).calls(2, [null, {}]);

  modify.determineModify(changelog, replContext, function() {
    t.equal(replContext.localClient.assert(), false);

    // determine modify should not call delete
    replContext.localClient = mock.mock('del').takes(
      changelog.object.targetdn, function(){}).calls(1, [null, {}]);

    modify.determineModify(changelog, replContext, function() {
      t.equal(replContext.localClient.assert(), false);

      // determine modify should not call add
      replContext.localClient = mock.mock('add').takes(changelog.object.targetdn, changelog.object.entry, function(){}).calls(2, [null, {}]);

      modify.determineModify(changelog, replContext, function() {
        t.equal(replContext.localClient.assert(), false);
        t.end();
      });
    });
  });
});

/**
 * The local entry matches the filter, but the modified remote entry does not
 */
test('determine modify condition 3', function(t) {
  var changelog = {
    object: {
      targetdn: 'cn=foo, o=yunong',
      entry: {
        objectclass: [ 'user' ],
        pets: ['honey badger', 'bear']
      },
      changes: [{
        operation: 'add',
        modification:{
          type: 'pets',
          vals: ['honey badger', 'bear']
        }
      }, {
        operation: 'delete',
        modification: {
          type: 'uid'
        }
      }]
    },
    localEntry: {
      object: {
        objectclass: [ 'user' ],
        uid: uuid()
      }
    },
    localDn: 'cn=foo, o=yunong'
  };

  // determine modify should call delete
  replContext.localClient = mock.mock('del').takes(
    changelog.object.targetdn, function(){}).calls(1, [null, {}]);

  modify.determineModify(changelog, replContext, function() {
    t.equal(replContext.localClient.assert(), true);
    t.end();
  });
});

/**
 * The remote modified entry matches the filter, but the local entry does not
 */
test('determine modify condition 4', function(t) {
  var changelog = {
    object: {
      targetdn: 'cn=foo, o=yunong',
      entry: {
        objectclass: [ 'user' ],
        pets: ['honey badger', 'bear'],
        uid: uuid()
      },
      changes: [{
        operation: 'add',
        modification:{
          type: 'uid',
          vals: uuid()
        }
      }]
    },
    localEntry: {
      object: {
        objectclass: [ 'user' ],
        pets: ['honey badger', 'bear']
      }
    },
    localDn: 'cn=foo, o=yunong'
  };

  replContext.localClient = mock.mock('modify').takes(
    changelog.object.targetdn, changelog.object.changes,
    function(){}).calls(2, [null, {}]);

  // should call modify
  modify.determineModify(changelog, replContext, function() {
    t.equal(replContext.localClient.assert(), true);
    t.end();
  });
});

/**
 * The entry does not exist locally, but the remote modified entry matches the
 * filter.
 */
test('determine modify condition 5', function(t) {
  var changelog = {
    object: {
      targetdn: 'cn=foo, o=yunong',
      entry: {
        objectclass: [ 'user' ],
        uid: uuid(),
        pets: ['honey badger', 'bear']
      },
      changes: [{
        operation: 'add',
        modification:{
          type: 'pets',
          vals: ['honey badger', 'bear']
        }
      }]
    },
    localDn: 'cn=foo, o=yunong'
  };

  replContext.localClient = mock.mock('add').takes(changelog.object.targetdn,
    changelog.object.entry, function(){}).calls(2, [null, {}]);

  modify.determineModify(changelog, replContext, function() {
    t.equal(replContext.localClient.assert(), true);
    t.end();
  });
});
