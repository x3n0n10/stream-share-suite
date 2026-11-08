# Share links

A share link lets a guest watch one live channel for a limited time, without an
account. You pick the channel and a window, for example Saturday 20:00 to 23:00
for a match. Outside the window the link does not play.

Open **Share links** in the sidebar. It lists the links of one instance at a
time. With several instances, pick one with the buttons at the top. The page
appears once an instance exists.

Share links cover live channels only. For a movie or an episode, use
[VOD search](dashboard.md). VOD links cannot be listed or revoked, so they are
not on this page.

## Creating a link

1. Click **+ New link**.
2. Search for the channel by name and pick it.
3. Optionally enter a **guest** label, up to 40 characters. It only helps you tell
   links apart.
4. Set **From** and **Until**. The window opens now and lasts two hours by
   default. A link may last 24 hours at most.
5. Click **Create link**.

The Suite then shows two addresses to send to your guest:

- **Playlist link:** for VLC and IPTV apps.
- **Stream link:** the channel itself, for players that take a direct address.

Up to three devices can use one link at once. Channels hidden by the instance's
catalogue filter do not appear in the search.

Links you create here are filed under the Suite's *VOD actor username*
(`suite` unless you changed it). Links people made with `/share` in Discord are
listed too.

## The list

| State | Meaning |
| --- | --- |
| **scheduled** | The window has not started yet. The guest can set the playlist up in advance. |
| **active** | Inside the window. The channel plays. |
| **ended** | The window is over. |
| **revoked** | You ended the link early. |

Active and scheduled links have **Playlist** and **Stream** buttons that copy the
addresses, and **Revoke**. A revoked link stops working at once. A link cannot
be edited. Revoke it and create a new one.

## When Copy is disabled

The Suite builds the addresses from the instance's **Public base URL**, because
the address the Suite itself uses to reach an instance means nothing to a guest.
Set it on the instance under **Stack**. An instance you added by hand has no
such setting, so the page shows the paths only (`/share/<token>.m3u` and
`/share/<token>/live.ts`) and leaves Copy disabled.

An instance running an image from before share links shows **This instance does
not support share links**. Update it and reload. See
[backups and updates](backups-and-updates.md#checking-for-updates).
