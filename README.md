## xmppfs
virtual xmpp file system

_use your standard shell to control your xmpp client!_

#### install

```bash
> sudo apt-get install libfuse-dev # debian
> git clone git://github.com/dodo/xmppfs.git
> cd xmppfs
> npm install .
```

#### run

```bash
> mkdir /tmp/xmpp
> cd xmppfs
> node xmppfs.js /tmp/xmpp
```

#### start

```bash
> mkdir /tmp/xmpp/juliet@capulet.lit
> echo -n 'your super secret password' > /tmp/xmpp/juliet@capulet.lit/password
> echo -n 'awesome resource' > /tmp/xmpp/juliet@capulet.lit/resource
> echo online > /tmp/xmpp/juliet@capulet.lit/state
```

#### chat

```bash
> mkdir /tmp/xmpp/juliet@capulet.lit/romeo@capulet.lit
> echo -n 'hello romeo' >> /tmp/xmpp/juliet@capulet.lit/romeo@capulet.lit/undefined/messages
```

#### read

```bash
> tail -f /tmp/xmpp/juliet@capulet.lit/romeo@capulet.lit/barok/messages
```

or just open `/tmp/xmpp/juliet@capulet.lit/romeo@capulet.lit/barok/messages` in a text editor, type something into the last line and save file :)

#### clear history

```bash
> truncate /tmp/xmpp/juliet@capulet.lit/romeo@capulet.lit/barok/messages
> # or
> echo -n 'now something completely different' > /tmp/xmpp/juliet@capulet.lit/romeo@capulet.lit/undefined/messages
```
