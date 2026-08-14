---
name: Shipping a code change
description: How this desk turns a ticket into a merged change — read the file before editing it, one branch per ticket, show the result, and let a human own the merge. Read this before github_edit_file or github_open_pr.
categories: [SOFTWARE, DEVOPS]
---

## When this applies

A ticket that needs the code itself to change: a bug fix, a copy change, a
config tweak, a small feature.

## Steps

1. **Find it before you change it.** `github_read_file` the file you intend to
   edit. `github_edit_file` is a find/replace — a replacement written from
   memory silently matches nothing, or matches in the wrong place.
2. **One branch per ticket**, named for the ticket, off the default branch.
   Never commit to the default branch.
3. **Smallest edit that fixes it.** Do not reformat surrounding code, rename
   things you happened to notice, or fix an unrelated bug in passing. Every
   extra line is a line the reviewer has to justify.
4. **Show the result.** For anything a person can see, `take_screenshot` of
   the before and the after and attach both to the ticket. A reviewer who can
   see the change approves faster and more safely than one who has to imagine
   it. The raw file of a branch works as a URL.
5. **Open the PR** with `github_open_pr`. The body says: what the ticket
   asked, what you changed, and how you checked it.
6. **Comment on the ticket** with the PR link before you finish.

## The merge belongs to a human

`github_merge_pr` is approval-gated. Ask for the merge when the change is
genuinely ready, and let the review happen — a PR waiting on a human is a
working state, not a failure. If the merge is rejected, acknowledge it on the
ticket and `escalate_to_human`; do not merge around it, and do not close the
ticket as resolved on the strength of an open PR unless the requester's ask
was the PR itself.

## Never

- Never edit a file you have not read in this run.
- Never touch secrets, credentials, CI tokens or deployment configuration as
  part of an ordinary fix — that is its own ticket, with its own review.
- Never widen the change because the fix "obviously" belongs somewhere else
  too. Say so in the PR body and let a human decide.
- Never report a change as shipped while the PR is still open.
