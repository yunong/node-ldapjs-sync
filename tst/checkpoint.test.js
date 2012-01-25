var test = require('tap').test;
var uuid = require('node-uuid');
var Checkpoint = require('../lib/checkpoint');
var ldapjsRiak = require('ldapjs-riak');


var cp;
var urls = ['url' + uuid(), 'url' + uuid()];

test('setup', function(t) {
  cp = new Checkpoint({
    bucket: 'changelogbucket' + uuid(),
    urls: urls
  });
  t.ok(cp);
  setTimeout(function() { t.end(); }, 1000);
});

test('initialized to 0', function(t) {
  cp.getChangelogCheckpoint(urls[0], function(err, ob, props) {
    t.equal(ob.changenumber, 0);
    cp.getCheckpoint(urls[0], function(err, ob, props) {
      t.equal(ob.changenumber, 0);
      t.end();
    });
  });
});

test('set checkpoint', function(t) {
  console.log('setting checkpoint');
  cp.setCheckpoint(urls[0], 100, function(err, obj, props) {
    cp.getCheckpoint(urls[0], function(err, ob, props) {
      t.equal(ob.changenumber, 100);
      t.end();
    });
  });
});

test('set changelog checkpoint', function(t) {
  console.log('setting checkpoint');
  cp.setChangelogCheckpoint(urls[0], 777, function(err, obj, props) {
    cp.getChangelogCheckpoint(urls[0], function(err, ob, props) {
      t.equal(ob.changenumber, 777);
      t.end();
    });
  });
});