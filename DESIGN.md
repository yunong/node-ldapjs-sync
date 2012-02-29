# Introduction

This document aims to explain the design of replication for LDAP.

LDAP replication will rely on two features built into LDAP, Persistent Search, and LDAP Changelogs.

# Persistent Search

For more information, check out the [RFC](http://tools.ietf.org/id/draft-ietf-ldapext-psearch-03.txt).

Persistent search extends the regular LDAP search operation by maintaining the  connection with the client after the initial results of the search operation have been returned. Clients will then receive additional results that match the search parameters as changes occur on the LDAP server.

As an example, suppose this is what’s stored in a remote ldap server:

    DN: o=smartdc
    objectclass: organization
    o: smartdc

    DN: ou=users, o=smartdc
    objectclass: organizationalUnit
    ou: users

    DN: ou=groups, o=smartdc
    objectclass: organizationalUnit
    ou: groups

    DN: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc
    login: admin
    uuid: 930896af-bf8c-48d4-885c-6573a94b1853
    userpassword: joypass123
    email: nobody@joyent.com
    cn: admin
    sn: user
    company: Joyent
    address: Joyent, Inc.
    address: 345 California Street, Suite 2000
    city: San Francisco
    state: CA
    postalCode: 94104
    country: USA
    phone: +1 415 400 0600
    objectclass: sdcPerson

    DN: cn=operators, ou=groups, o=smartdc
    uniquemember: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc
    objectclass: groupOfUniqueNames

A persistent search with parameters

    o=smartdc, scope=sub, filter=(objectclass=*)

will return all of these entries. The connection is not severed with the client.

If another client now goes and modifies or adds a new entry that matches the search parameters, such as:

    DN: uuid=a6b82ddf-6a17-4f19-a678-6c5c6dc7a5b6, ou=users, o=smartdc
    objectclass: sdcPerson

The persistent search client would be sent this entry as it matches the search criteria.

# Changelog

For more information, check out the [RFC](http://tools.ietf.org/html/draft-good-ldap-changelog-04).

Changelog is an object class in LDAP specifically meant to support replication. They represent a set of the changes which were made to the directory server.  These changes are in LDIF format, which is described in [\[1\]](http://tools.ietf.org/html/draft-good-ldap-changelog-04#ref-1). Clients can choose to update its own replicated copy of the data. The add of the "ou=users, o=smartdc" entry in the previous section would result in a changelog that looks like this:

    "dn": "changenumber=1326414273440, cn=changelog",
    "controls": [],
    "targetdn": "ou=users, o=smartdc",
    "changetime": "2012-01-13T00:24:33Z",
    "changenumber": "1326414273440",
    "changetype": "add",
    "changes": "{\"objectclass\":[\"organizationalUnit\"],\"ou\":[\"users\"]}",
    "objectclass": "changeLogEntry"

These are the key attributes of a changelog:

* changeNumber: the change number, as assigned by the supplier.  This integer MUST strictly increase as new entries are added, and must always be unique within a given server.

* targetDN: the distinguished name of the entry which was added, modified or deleted.

* changeType: the type of change. One of: "add", "delete", "modify",

* changes: the changes which were made to the directory server.  These changes are in LDIF format, which is described in [\[1\]](http://tools.ietf.org/html/draft-good-ldap-changelog-04#ref-1).


A changelog object is generated for every operation performed by the LDAP server. Persistent searches also works for changelogs in exactly the same fashion. Searching for changelogs with parameters

    cn=changelog, filter=(changenumber>=0)

would return all changelogs on the remove server as well as any future changelogs. By replaying all changelogs in order from the remote server, a client is able to replicate all entries on the remote server. One feature that changelogs don't support is the ability to filter the changelog based on the attributes of the targetDN's entry. The changelog only contains the attributes that were changed, and not the entire set of attributes. This can be mitigated, which is described later on in the design section.

# Requirements
We would like replication to achieve the following:

* Fault tolerance, i.e. the ability withstand network partitions.
* Selective replication, i.e. the ability to only replicate part of a directory.
* Multi server replication, i.e. the ability to replicate from multiple remote servers. Specifically, we want to pull different parts of the directory tree from different remote masters. It's a non-goal to pull the same tree from N remotes. An example of why this would be nice is to eventually pull in ActiveDirectory/... into our tree(s).

# Design

The general scheme for replication is as follows.

A client synchronizes its local copy of a remote server’s contents by performing a persistent search on the remote server’s changelog for any entries where the changenumber is greater than or equal to the last change previously retrieved from that server.
If the client has successfully retrieved one or more changelog entries from the server, it can then use the information contained in each entry to update the corresponding entry in its local datastore.
Update the latest change number to the last read entry.
Details of this design will follow in the replication section.

## Change Numbers
This design relies on strictly increasing change numbers which map the order of events on the remote server. This requirement guarantees the strict ordering of events. This in turn requires a datastore that supports either transactions or optimistic concurrency control. The following example illustrates why. Assume the current state of the system is as shown in the example of the persistent search section. Two concurrent client modify requests come in to the system with different parameters:

    Modify "DN: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc", "changes: {city: LA}"

    Modify "DN: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc", "changes: {city: Seattle}"

Suppose change numbers are generated by an independent agent which returns increasing integers based on the order of requests. i.e. requests that appear to the agent first gets the smaller change number. Now assume request 1 got the lower changenumber, and request 2 got the higher chang number. The two requests now need to persist their changes to the datastore. Since the datastore is independent of the changenumber generator, request 2 gets there first, and so applies its changes first. Request 1 gets there later, and so the steady state result after the two request is that the city = LA:

    dn: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc
    login: admin
    uuid: 930896af-bf8c-48d4-885c-6573a94b1853
    userpassword: joypass123
    email: nobody@joyent.com
    cn: admin
    sn: user
    company: Joyent
    address: Joyent, Inc.
    address: 345 California Street, Suite 2000
    city: LA
    state: CA
    postalCode: 94104
    country: USA
    phone: +1 415 400 0600
    objectclass: sdcPerson

But the changelog looks like:

    {
      "dn": "changenumber=1, cn=changelog",
      "controls": [],
      "targetdn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc",
      "changetime": "2012-01-13T00:24:33Z",
      "changenumber": "1326414273594",
      "changetype": "modify",
      "changes": "{\"city\": [\"LA\"]}",
      "objectclass": "changeLogEntry"
    }
    {
      "dn": "changenumber=2, cn=changelog",
      "controls": [],
      "targetdn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc",
      "changetime": "2012-01-13T00:24:33Z",
      "changenumber": "1326414273594",
      "changetype": "modify",
      "changes": "{\"city\": [\"Seattle\"]}",
      "objectclass": "changeLogEntry"
    }

A remote server who is replaying the changes will replay the changelogs in order of their changenumbers, and end up with a different entry, where city=Seattle. The problem is getting the changenumber, writing the changelog and writing the entry are all separate events.

This can be solved with transactions. This design assumes the availability of a datastore with one of those characteristics.

### Transactions
The latest changenumber is inlined in to the entry. We simply wrap getting the changenumber, writing the changelog and writing the entry in one transaction, one which can be rolled back if entry.changenumber is greater than the changenumber in the changelog.

## Checkpoint

The checkpoint is the latest replicated changenumber stored by the local client. They're used to keep track of the progress of replication. On network partitions/client crashes, the client resumes replication from the checkpoint. Changes are replayed by the client serially, which means any consistent and durable key value store can be used to store the checkpoint. The checkpoint is stored locally in LDAP.

## Configuration
Clients configure replication by specifying a replication ldap url:

    ldaps://host:port/dn?attributes?scope?filter?extensions

The important fields are the DN and filter fields. The DN and filter fields of the url are used to specify which parts of the remote directory tree to replicate. This allows for selective replication of parts of a directory tree.

## Replication
The replication scheme works well if the client is aiming to replicate the entire contents of the remote server. However, the client may only want to replicate a subset of the directory. Some more steps are needed to ensure only entries that match the DN and filter of the replication url are replicated.

To avoid replicating the all of the remote server’s entries, every changelog entry received from the server will require the client to first match the targetDN of the changelog against the DN of the client replication url. This will ensure that the remote entry resides in the same directory. If the DNs match, the client must check whether its replication filter matches the entry. There are 3 different types of chaneglogs, adds, modifies, and deletes. Replicated entries will contain an extra attribute _url=$url to denote which remote server it was replicated from.

## Add
The addition of an entry is the simplist case. An add changelog looks like this:

    {
      "dn": "changenumber=1326414273593, cn=changelog",
      "controls": [],
      "targetdn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc",
      "changetime": "2012-01-13T00:24:33Z",
      "changenumber": "1326414273593",
      "changetype": "add",
      "changes": "{\"address\":[\"Joyent, Inc.\",\"345 California Street, Suite 2000\"],\"city\":[\"San Francisco\"],\"cn\":[\"admin\"],\"company\":[\"Joyent\"],\"country\":[\"USA\"],\"email\":[\"nobody@joyent.com\"],\"login\":[\"admin\"],\"objectclass\":[\"sdcPerson\"],\"phone\":[\"+1 415 400 0600\"],\"postalcode\":[\"94104\"],\"sn\":[\"user\"],\"state\":[\"CA\"],\"userpassword\":\"XXXXXX\",\"uuid\":[\"930896af-bf8c-48d4-885c-6573a94b1853\"],\"_salt\":[\"8ce62127c82af53aae281e907729782991f57a5f\"],\"_owner\":[\"930896af-bf8c-48d4-885c-6573a94b1853\"]}",
      "objectclass": "changeLogEntry"
    }

The changes field of the changelog contains the entire entry contents. Thus the local service can create the entry and match it against the filter in the replication url. If the entry matches, it is persisted to the local datastore, if the entry does not match, then it is discarded.

## Delete
Deletes are tricky. Given the entry:

    DN: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc
    login: admin
    uuid: 930896af-bf8c-48d4-885c-6573a94b1853
    ...
    objectclass: sdcPerson

and this series of events on the server, creation and deletion of an entry:
... Directory setup omitted.

    {
      "dn": "changenumber=1326414273593, cn=changelog",
      "controls": [],
      "targetdn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc",
      "changetime": "2012-01-13T00:24:33Z",
      "changenumber": "1326414273593",
      "changetype": "add",
      "changes": "{\"address\":[\"Joyent, Inc.\",\"345 California Street, Suite 2000\"],\"city\":[\"San Francisco\"],\"cn\":[\"admin\"],\"company\":[\"Joyent\"],\"country\":[\"USA\"],\"email\":[\"nobody@joyent.com\"],\"login\":[\"admin\"],\"objectclass\":[\"sdcPerson\"],\"phone\":[\"+1 415 400 0600\"],\"postalcode\":[\"94104\"],\"sn\":[\"user\"],\"state\":[\"CA\"],\"userpassword\":\"XXXXXX\",\"uuid\":[\"930896af-bf8c-48d4-885c-6573a94b1853\"],\"_salt\":[\"8ce62127c82af53aae281e907729782991f57a5f\"],\"_owner\":[\"930896af-bf8c-48d4-885c-6573a94b1853\"]}",
      "objectclass": "changeLogEntry"
    }

    {
      "dn": "changenumber=1326414273594, cn=changelog",
      "controls": [],
      "targetdn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc",
      "changetime": "2012-01-13T00:24:33Z",
      "changenumber": "1326414273594",
      "changetype": "delete",
      "objectclass": "changeLogEntry"
    }

The second changelog which denotes the deletion of the entry. Unlike add type changelogs, delete type changelogs do not contain information about the contents of the entry. The local server needs the entire entry contents to determine whether this entry matches the replication filter. This can be accomplished by searching locally for this entry. There are 3 scenarios:

1. The entry exists locally and matches the replication filter.
2. The entry doesn't exist locally.
3. The entry exists locally and doesn't match the replication filter.

Scenario 1 indicates the entry is one that is global and replicated locally, and thus will be deleted. Scenario 2 indicates the entry was never created, thus must have been a remote local entry, and thus the changelog is ignored. Scenario 3 indicates the rare case that there exists 2 identical but distinct local copies of the same entry on both local and remote servers. The remote server has decided to delete its entry, which should not affect the local server's copy, thus the changelog is ignored.

## Modify
The simple modification case is exactly like a delete. Given a replication url:

    ldaps://123.456.789.123:12345/o=smartdc??sub?(&(company=joyent)(objectclass=sdcperson))?

The DN in this case is

    o=smartdc, and the filter is (company=Joyent).

This means we want to replicate under the directory o=smartdc all entries which are sdcpersons who work for joyent. Now consider this series of changelogs, where a sdcPerson entry is created, and then its country changed from USA to Canada.

... Directory setup omitted.

    {
      "dn": "changenumber=1326414273593, cn=changelog",
      "controls": [],
      "targetdn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc",
      "changetime": "2012-01-13T00:24:33Z",
      "changenumber": "1326414273593",
      "changetype": "add",
      "changes": "{\"address\":[\"Joyent, Inc.\",\"345 California Street, Suite 2000\"],\"city\":[\"San Francisco\"],\"cn\":[\"admin\"],\"company\":[\"Joyent\"],\"country\":[\"USA\"],\"email\":[\"nobody@joyent.com\"],\"login\":[\"admin\"],\"objectclass\":[\"sdcPerson\"],\"phone\":[\"+1 415 400 0600\"],\"postalcode\":[\"94104\"],\"sn\":[\"user\"],\"state\":[\"CA\"],\"userpassword\":\"XXXXXX\",\"uuid\":[\"930896af-bf8c-48d4-885c-6573a94b1853\"],\"_salt\":[\"8ce62127c82af53aae281e907729782991f57a5f\"],\"_owner\":[\"930896af-bf8c-48d4-885c-6573a94b1853\"]}",
      "objectclass": "changeLogEntry"
    }
    {
      "dn": "changenumber=1326414273594, cn=changelog",
      "controls": [],
      "targetdn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc",
      "changetime": "2012-01-13T00:24:33Z",
      "changenumber": "1326414273594",
      "changetype": "modify",
      "changes": "{\"country\": [\"Canada\"]}",
      "objectclass": "changeLogEntry"
    }

After processing of the first changelog, there now exists the following entry locally:

    dn: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc

    login: admin
    uuid: 930896af-bf8c-48d4-885c-6573a94b1853
    company: Joyent
    ...
    objectclass: sdcPerson

Note that the second changelog entry containing the modification does not contain the entire contents of the modified entry, but only the change itself, country: Canada. Just like the delete operation, there's not enough context to match the filter. The local client must search for this entry by only using the DN. It's important that filtering is not applied during the search, as we'll see in a moment. If there exists an entry for that DN, the local client reconstructs the entry with the changes specified in the changelog in memory. It then tries to match that entry against the replication filter. There are 5 scenarios:

1. Both modified and unmodified entries match the filter.
2. Neither entry matches the filter.
3. The modified entry doesn't match the filter, but the unmodified entry does.
4. The modified entry matches the filter, but the unmodified entry does not.
5. The entry does not exist locally, but the remote modified entry matches the filter.

Let's start with #1. This is the easiest case, where an attribute was changed which did not affect the replication scope of the entry. This is the case of the example given, where the country attribute is changed. The entry is modified locally. Moving on to #2, this indicates the rare case that there exists 2 local entries with identical DNs in both remote and local datacenters. Since neither matches, the change is ignored. Scenario #3 is an example where the entry used to match the replication filter, but after modification does not. An example would be the following changelog:

    {
      "dn": "changenumber=1326414273594, cn=changelog",
      "controls": [],
      "targetdn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc",
      "changetime": "2012-01-13T00:24:33Z",
      "changenumber": "1326414273594",
      "changetype": "modify",
      "changes": "{\"company\": [\"NBA\"]}",
      "objectclass": "changeLogEntry"
    }
We see that our Joyent employee has now become an NBA star. This entry will no longer match the filter, and so must be deleted from the local datastore. The next 2 are the tricky scenarios. Here's an example of of #4, given the entry locally:

    dn: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc

    login: admin
    uuid: 930896af-bf8c-48d4-885c-6573a94b1853
    company: NBA
    ...
    objectclass: sdcPerson

Since company=NBA, this entry was a local entry and not replicated. However, the following changelog appears:

    {
      "dn": "changenumber=1326414273594, cn=changelog",
      "controls": [],
      "targetdn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc",
      "changetime": "2012-01-13T00:24:33Z",
      "changenumber": "1326414273594",
      "changetype": "modify",
      "changes": "{\"company\": [\"Joyent\"]}",
      "objectclass": "changeLogEntry"
    }

Looks like our NBA star has retired and started a new career at Joyent. The new entry remotely looks like:

    dn: uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc

    login: admin
    uuid: 930896af-bf8c-48d4-885c-6573a94b1853
    company: Joyent
    ...
    objectclass: sdcPerson

Which would match the replication filter, which the local server would want to replicate. This again, indicates the rare case that there were 2 local entries with identical DNs but different attributes. Since the local entry has now become a global entry, the local server should overwrite its local entry with the new global entry. Note that the local entry is wiped out, replaced with the remote entry. Scenario #5 indicates that the replication scope of the remote entry has now been modified to match the replication criteria, and has changed from a local entry to a global entry. Thus this entry should be added to the local datastore. Scenarios 4 and 5 are in essence additions of new entries. However the local server lacks the entire entry, as the local entry is either different (scenario 4), or non-existent (scenario 5). The local server could search the remote server for the entry, however, there's no guarantee that the remote entry has been changed by additional events which occurred after the current changelog. Thus, modification changelogs must contain a complete copy of the new changed entry, stored in the field titled entry. Modify changelogs now look like:

    {
      "dn": "changenumber=1326414273594, cn=changelog",
      "controls": [],
      "targetdn": "uuid=930896af-bf8c-48d4-885c-6573a94b1853, ou=users, o=smartdc",
      "changetime": "2012-01-13T00:24:33Z",
      "changenumber": "1326414273594",
      "changetype": "modify",
      "changes": "{\"company\": [\"Joyent\"]}",
      "entry": "{\"address\":[\"Joyent, Inc.\",\"345 California Street, Suite 2000\"],\"city\":[\"San Francisco\"],\"cn\":[\"admin\"],\"company\":[\"Joyent\"],\"country\":[\"USA\"],\"email\":[\"nobody@joyent.com\"],\"login\":[\"admin\"],\"objectclass\":[\"sdcPerson\"],\"phone\":[\"+1 415 400 0600\"],\"postalcode\":[\"94104\"],\"sn\":[\"user\"],\"state\":[\"CA\"],\"userpassword\":\"XXXXXX\",\"uuid\":[\"930896af-bf8c-48d4-885c-6573a94b1853\"],\"_salt\":[\"8ce62127c82af53aae281e907729782991f57a5f\"],\"_owner\":[\"930896af-bf8c-48d4-885c-6573a94b1853\"]}",

      "objectclass": "changeLogEntry"
    }

With the addition of the entry field, scenarios 1, 4, 5 are simply add operations with the entry specified in the entry field.

# Fault Tolerance

As long as the local server durably persists the checkpoint, network partitions between the local server and the remote server can be tolerated. Upon re-establishment of the connection to the remote server, the local server picks up from its checkpoint and continues replicating. Data loss resulting from corrupt datastores can be recovered as long as one copy of the changelog exists in any of the replicated DCs. The LDAP directory can always be regenerated by replaying all changelogs starting at changenumber 0. However, any local entries created under remote entries will be lost.

Local entries created under a replicated global entry come with the caveat that the deletion of the parent global entry without the removal of all local child entries in all replicated DCs will result in corrupt directories in all those DCs.

