# About
[ldapjs-sync](https://github.com/yunong/node-ldapjs-sync) is a replication
framework for [ldapjs](https://github.com/mcavage/node-ldapjs). It's based 
loosely on the ldap persistent search
[rfc](http://tools.ietf.org/id/draft-ietf-ldapext-psearch-03.txt).

# Design

It's assumed that the reader is familiar with ldap, ldap changelogs, and ldap persistent
search. If not, take a look at the [ldapjs guide](http://ldapjs.org/guide.html) first.

Given a master ldap server A, and a slave ldap server B, replication from A to B is
performed as follows (at a very high level):

1. B gets changes from A by searching A for changelogs.
2. B applies the changelogs from A.

# Requirements

## Transactions

## Persistent Search

## Changelogs

# Usage
    var ldapjs-sync = require('ldapjs-sync');

    var Replicator = new ldapjs-sync();
    var options = {

    };
    Replicator.on('init', function() {
      console.log('replication has started');
    });

    Replicator.init(options);

You can also run the replicator from the cmd line

    $ ./bin/main.js -f ../cfg/config.json

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