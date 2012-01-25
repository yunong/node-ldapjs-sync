var ldap = require('ldapjs');
var log4js = require('log4js');
var test = require('tap').test;
var uuid = require('node-uuid');
var ldapjsRiak = require('ldapjs-riak');
var ldapjsSync = require('../lib/index');
var EntryQueue = require('../lib/entryQueue');

///--- Globals
var REMOTE_URL ='ldap://127.0.0.1:' + 23444 + '/' +
                'o=yunong' + '??sub?(objectclass=*)';

var queue;
var url = ldap.url.parse(REMOTE_URL, true);
test('setup-entry-queue', function(t) {
  url.entries = [];
  queue = new EntryQueue({urls: [url]});
  t.ok(queue);
  t.end();
});

test('push event', function(t) {
  var entry = {
    foo: 'bar',
    baz: 'car'
  };

  queue.on('gotEntry', function(gotEntry, index, entries) {
    console.log('entry', entry);
    console.log('gotEntry', gotEntry);
    t.equal(entry, gotEntry);
    t.end();
  });

  queue.push(url, entry);
});