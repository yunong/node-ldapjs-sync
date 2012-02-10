var add         = require('../lib/add.js');
var ldap        = require('ldapjs');
var log4js      = require('log4js');
var test        = require('tap').test;
var uuid        = require('node-uuid');
var vm          = require('vm');
var ldapjsRiak  = require('ldapjs-riak');
var ldapjsSync  = require('../lib/index');
var Checkpoint  = require('../lib/checkpoint');
var EntryQueue  = require('../lib/entryQueue');
var ReplContext = require('../lib/replContext');

var inMemLdap   = require('./inmemLdap');

///--- Globals
var SUFFIX        = 'o=yunong';
var SOCKET        = '/tmp/.' + uuid();
var REMOTE_PORT   = 23364;
var TOTAL_ENTRIES = 5;
var REMOTE_URL    = 'ldap://cn=root:secret@0.0.0.0:' + REMOTE_PORT + '/' +
                    SUFFIX + '??sub?(uid=*)';

var LOCAL_PORT    = 23456;
var LOCAL_URL     = 'ldap://cn=root:secret@localhost:' + LOCAL_PORT;

var CHECKPOINT_OPTIONS = {
  dn: 'cn=checkpoint, o=yunong',
  url: REMOTE_URL,
  localUrl: LOCAL_URL,
  log4js: log4js
};

var checkpoint;
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

test('setup-checkpoint', function(t) {
  checkpoint = new Checkpoint();

  checkpoint.once('init', function(changenumber) {
    t.equal(changenumber, 0);
    t.end();
  });

  checkpoint.init(CHECKPOINT_OPTIONS);
});

test('set/get checkpoint', function(t) {
  checkpoint.setCheckpoint(100, function(err, res) {
    if (err) {
      t.fail(err);
      t.end();
    }
    t.ok(res);

    checkpoint.getCheckpoint(function(cn) {
      t.equal((cn == 100), true);
      t.end();
    });
  });
});