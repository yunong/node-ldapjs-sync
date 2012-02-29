/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var inMemLdap = require('../lib/inMemLdap');
var ldapjs = require('ldapjs');
var uuid = require('node-uuid');

inMemLdap.startServer({suffix: 'o=oz', port: 23455}, function() {
  var client = ldapjs.createClient({
    url: 'ldap://cn=root:secret@0.0.0.0:23455'
  });

  client.once('connect', function() {
    client.bind('cn=root', 'secret', function(err, res) {
      var rainbow = {
        objectclass: 'replicated directory',
        uid: uuid()
      };

      // create the root dn for replication
      client.add('o=oz', rainbow, function() {});
    });
  });
});
