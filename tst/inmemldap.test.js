/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var add = require('../lib/add.js');
var bunyan = require('bunyan');
var ldap = require('ldapjs');
var test = require('tap').test;
var uuid = require('node-uuid');
var vm = require('vm');
var EntryQueue = require('../lib/entryQueue');
var ReplContext = require('../lib/replContext');

var inMemLdap = require('./inmemLdap');

///--- Globals
var SUFFIX = 'o=yunong';
var SOCKET = '/tmp/.' + uuid();
var REMOTE_PORT = 23364;
var TOTAL_ENTRIES = 5;
var REMOTE_URL = 'ldap://cn=root:secret@0.0.0.0:' + REMOTE_PORT + '/' +
                    SUFFIX + '??sub?(uid=*)';

var LOCAL_PORT = 23456;
var LOCAL_URL = 'ldap://localhost:' + LOCAL_PORT;

var log = new bunyan({
    name: 'crud-integ-test',
    stream: process.stdout,
    level: 'trace',
    src: true
});

var ALL_CHANGES_CTRL = new ldap.PersistentSearchControl({
  type: '2.16.840.1.113730.3.4.3',
  value: {
    changeTypes: 15,
    changesOnly: false,
    returnECs: true
  }
});

var REPL_CONTEXT_OPTIONS = {
  log: log,
  url: REMOTE_URL,
  checkpointBucket: uuid()
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

test('add fixtures', function(t) {
  var entry = { objectclass: 'executor', uid: 'foo' };
  localClient.add('o=yunong', entry, function(err, res) {
    if (err) {
      t.fail(err);
    }

    localClient.search('o=yunong', '(objectclass=*)', function(err, res) {
      console.log('searching locally');
      if (err) {
        t.fail(err);
        t.end();
      }

      res.on('searchEntry', function(entry) {
        // console.log(JSON.stringify(entry.object, null, 2) + '\n');
        console.log('got search entry');
        t.ok(entry);
        // t.ok(entry instanceof ldap.SearchEntry);
        t.ok(entry.dn.toString());
        t.ok(entry.attributes);
        t.ok(entry.attributes.length);
        t.ok(entry.object);
        t.equal(entry.dn.toString(), 'o=yunong');
        // t.equal(entry.object, entry);
        console.log(entry.object);
        // t.end();
      });

      res.on('error', function(err) {
        t.fail(err);
        t.end();
      });

      res.on('end', function(res) {
        t.end();
      });
    });
  });
});

test('modify fixtures', function(t) {
  var change = new ldap.Change({
    type: 'replace',
    modification: new ldap.Attribute({
      type: 'uid',
      vals: 'bar'
    })
  });
  localClient.modify('o=yunong', change, function(err, res) {
    console.log(res);
    t.end();
  });
});
