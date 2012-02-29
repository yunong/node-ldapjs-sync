/**
 * Copyright 2012 Yunong Xiao, Inc. All rights reserved.
 */

var inMemLdap = require('../lib/inMemLdap');
var ldapjs = require('ldapjs');
var uuid = require('node-uuid');

inMemLdap.startServer({suffix: 'o=kansas', port: 23456}, function() {
  var client = ldapjs.createClient({
    url: 'ldap://cn=root:secret@0.0.0.0:23456'
  });

  client.once('connect', function() {

    client.bind('cn=root', 'secret', function(err, res) {
      // add some fixtures
      var kansas = {
        objectclass: 'state',
        uid: uuid()
      };

      client.add('o=kansas', kansas, function(err, res) {
        var dorothy = {
          objectclass: 'person',
          uid: uuid()
        };

        client.add('cn=dorothy, o=kansas', dorothy, function(err, res) {
          var toto = {
            objectclass: 'dog',
            uid: uuid()
          };

          client.add('cn=toto, cn=dorothy, o=kansas', toto,
                     function(err, res) {});
        });

        var silverShoes = {
          objectclass: 'shoes',
          uid: uuid()
        };

        client.add('cn=silver shoes, cn=dorothy, o=kansas', silverShoes,
                   function() {});
      });
    });
  });
});
