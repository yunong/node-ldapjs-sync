# About
[ldapjs-sync](https://github.com/yunong/node-ldapjs-sync) is a replication
framework for [ldapjs](https://github.com/mcavage/node-ldapjs).

# Design

It's assumed that the reader is familiar with ldap, ldap changelogs, and ldap persistent
search. If not, take a look at the [ldapjs guide](http://ldapjs.org/guide.html) first and the
[psearch](http://tools.ietf.org/id/draft-ietf-ldapext-psearch-03.txt) and
[changelog](http://tools.ietf.org/html/draft-good-ldap-changelog-04) rfcs.

Given a master ldap server A, and a slave ldap server B, replication from A to B is
performed as follows (at a very high level):

1. B gets changes from A by searching A for changelogs.
2. B applies the changelogs from A.

For more information on the design, see: [ldapjs-sync design](link needed).

# Requirements

The backend implementation of the remote server must support transactions, persistent search, and changelogs. The reference in memory ldap backend at lib/inmemLdap.js implements the following requirements.

## Changelogs

The master ldap server backend must implement ldap [changelogs](http://tools.ietf.org/html/draft-good-ldap-changelog-04)
. The changenumbers must be strictly increasing, corresponding with the order of events.

An additional "entry" field which contain the complete copy of the modified entry must be added to all "modify" changelogs.

## Transactions

This design relies on strictly increasing change numbers which map the order of events on the remote server. This requirement guarantees the strict ordering of events. This in turn requires a datastore that supports transactions.

## Persistent Search

Persistent search must be implemented for changelogs. This allows the slave server to listen for changes from the master. For more information, see the ldap persistent search
[rfc](http://tools.ietf.org/id/draft-ietf-ldapext-psearch-03.txt).

# Usage
    var ldapjs-sync = require('ldapjs-sync');
    var bunyan = require('bunyan');

    var log = new bunyan({
      name: 'ldap-replication',
      stream: process.stdout
    });

    var Replicator = new ldapjs-sync();

    // replicator configs
    var options = {
      log: log,
      url: 'ldap://cn=root:secret@0.0.0.0:23364/o=oz??sub?(uid=*)',
      localUrl: 'ldap://cn=root:secret@0.0.0.0:23456',
      checkpointDn: 'o=somewhereovertherainbow',
      replSuffix: 'o=somewhereovertherainbow',
      localPoolCfg: {
        max: 10,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 1000,
        log: log
      },
      remotePoolCfg: {
        max: 10,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 1000,
        log: log
      }
    };

    Replicator.on('init', function() {
      console.log('replication has started');
    });

    // initialize the replicator
    Replicator.init(options);

You can also run the replicator from the cmd line like so.

    $ ./bin/main.js -f ./cfg/config.json

# Configuration

    Replicator() accepts an options object with these members:
        url: the ldap url of the remote master server. (string)
        localUrl : the ldap url of the local slave server. (string)
        log : the bunyan log object. (bunyan log object)
        checkpointDn : the root dn where the checkpoint is stored. (string)
        replSuffix : the root dn where the replicated entries are stored on the slave. (string)
        localPoolCfg: the node-pool config for the local client. (object, optional)
        remotePoolCfg: the node-pool config for the remote client. (object, optional)

## Replication URLs

[ldap urls](http://www.ietf.org/rfc/rfc2255.txt) are used to specify the remote ldap server with which to replicate from. Specifically the following url fields are used for replication. Given a url:
    ldap://binddn:pw@addr:port/dn??scope?filter

    binddn : bind DN.
    pw : bind password.
    addr : server address.
    port : server port.
    dn : root dn to replicate from.
    scope : one of "base" / "one" / "sub". (most cases sub would be used)
    filter : filter used for the replicated entries.

The dn and filter fields allow the replication of only a portion of a ldap directory.

## Pool Configs

Replication utilizes the [node-pool](https://github.com/coopernurse/node-pool) lib for connection pooling. They can be
configured per the node-pool docs.

## Checkpoint DN

The replicator

# Installation

    $ npm install ldapjs-sync

## License

The MIT License (MIT)
Copyright (c) 2012 Yunong Xiao

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.