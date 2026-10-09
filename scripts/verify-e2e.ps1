# End-to-end verification of the ThinkLot auth + ideas chain against the live
# dev deployment, including the negative authorization cases.
#
# Note: the Convex HTTP API responds { status, value } on success and
# { status: "error", errorMessage } on failure. There is no `.result`.
$ErrorActionPreference = 'Stop'

$CONVEX = 'https://posh-chihuahua-240.convex.cloud'
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$pass = 'correct-horse-battery-staple'

function Call {
    param([string]$Path, [string]$ArgsJson = '{}', [string]$Token = $null, [ValidateSet('query','mutation','action')][string]$Kind = 'query')
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $body = @{ path = $Path; args = ($ArgsJson | ConvertFrom-Json); format = 'json' } | ConvertTo-Json -Depth 20 -Compress
    try {
        $r = Invoke-RestMethod -Uri "$CONVEX/api/$Kind" -Method Post -Headers $headers -Body $body -TimeoutSec 40
    } catch {
        return @{ status = 'error'; errorMessage = ($_.ErrorDetails.Message ?? $_.Exception.Message) }
    }
    return $r
}

$passes = 0
$failures = @()

function Check {
    param([string]$Name, [bool]$Ok, [string]$Detail = '')
    if ($Ok) { Write-Host "  PASS  $Name" -ForegroundColor Green; $script:passes++ }
    else { Write-Host "  FAIL  $Name   $Detail" -ForegroundColor Red; $script:failures += $Name }
}

function Refused($r) { return $r.status -eq 'error' }

Write-Host "`n== 1. Unauthenticated access must be refused ==" -ForegroundColor Cyan
Check "ideas:list without a token is refused"  (Refused (Call 'ideas:list'))  ((Call 'ideas:list').errorMessage)
Check "ideas:stats without a token is refused" (Refused (Call 'ideas:stats'))
Check "ideas:capture without a token is refused" (Refused (Call 'ideas:capture' '{"title":"x"}' $null 'mutation'))
Check "ideas:remove without a token is refused"  (Refused (Call 'ideas:remove' '{"ideaId":"j97k0000000000000000000000"}' $null 'mutation'))

Write-Host "`n== 2. Sign up ==" -ForegroundColor Cyan
$emailA = "qa-a-$stamp@example.com"
$signUpA = Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$emailA; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
$tokenA = $signUpA.value.tokens.token
Check "signup returns an access token" (-not [string]::IsNullOrEmpty($tokenA)) "status=$($signUpA.status) $($signUpA.errorMessage)"

$meA = Call 'users:current' '{}' $tokenA
Check "users:current resolves the signed-in email" ($meA.value.email -eq $emailA) "-> $($meA.value.email)"

$badPass = Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$emailA; password='wrong-password'; flow='signIn' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
Check "wrong password is rejected" (Refused $badPass) "-> status=$($badPass.status)"

Write-Host "`n== 2b. Sign IN with an existing account ==" -ForegroundColor Cyan
# This exact check was MISSING before, which is how a completely broken login
# shipped: the client omitted `flow`, so Convex Auth rejected every sign-in with
# "Missing `flow` param" and nobody could get in. The suite only ever exercised a
# WRONG password, which failed for the right reason and hid the bug.
$login = Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$emailA; password=$pass; flow='signIn' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
$loginToken = $login.value.tokens.token
Check "signing in with an existing account succeeds" (-not [string]::IsNullOrEmpty($loginToken)) "status=$($login.status) $($login.errorMessage)"

$asLoggedIn = Call 'users:current' '{}' $loginToken
Check "the signed-in token resolves to the same user" ($asLoggedIn.value.email -eq $emailA) "-> $($asLoggedIn.value.email)"

$noFlow = Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$emailA; password=$pass } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
Check "signIn without `flow` is refused (documents the footgun)" (Refused $noFlow)

Write-Host "`n== 3. Capture an idea ==" -ForegroundColor Cyan
$captured = Call 'ideas:capture' (@{ title='Whispr into the capture bar'; description='dictated, keep the raw text'; source='dictated'; transcript='whispr into the capture bar. dictated, keep the raw text' } | ConvertTo-Json -Depth 6 -Compress) $tokenA 'mutation'
$ideaIdA = $captured.value
Check "capture returns an idea id" ("$ideaIdA".Length -gt 10) "-> status=$($captured.status) $($captured.errorMessage)"

$listA = Call 'ideas:list' '{}' $tokenA
Check "list returns exactly the one captured idea" (@($listA.value.ideas).Count -eq 1) "-> count=$(@($listA.value.ideas).Count)"
Check "plate sequence starts at 1" ($listA.value.ideas[0].seq -eq 1) "-> seq=$($listA.value.ideas[0].seq)"
Check "title was parsed" ($listA.value.ideas[0].title -eq 'Whispr into the capture bar') "-> $($listA.value.ideas[0].title)"
Check "dictation source preserved" ($listA.value.ideas[0].source -eq 'dictated') "-> source=$($listA.value.ideas[0].source)"
Check "list ships a preview, not the whole 20KB body" ($null -ne $listA.value.ideas[0].preview -and $null -eq $listA.value.ideas[0].transcript) "preview=$($listA.value.ideas[0].preview)"

$fullA = Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenA
Check "get returns the verbatim transcript" ($fullA.value.idea.transcript -like '*keep the raw text*') "-> $($fullA.value.idea.transcript)"

$statsA = Call 'ideas:stats' '{}' $tokenA
Check "stats totals 1 idea" ($statsA.value.total -eq 1) "-> total=$($statsA.value.total)"

Write-Host "`n== 3b. Email normalisation ==" -ForegroundColor Cyan
# Convex Auth's default profile returns params.email verbatim and uses it as the
# account id, so UPPER / padded variants each created a SEPARATE account for the
# same mailbox - which is also a squatting primitive. After normalisation every
# spelling must resolve to the SAME user id (session ids legitimately differ).
function JwtSubject($token) {
    $p = $token.Split('.')[1].Replace('-', '+').Replace('_', '/')
    while ($p.Length % 4 -ne 0) { $p += '=' }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
    return ($json.sub -split '\|')[0]
}

$upper = Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$emailA.ToUpper(); password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
Check "uppercase variant of the same email resolves to the SAME user" ((JwtSubject $upper.value.tokens.token) -eq (JwtSubject $tokenA)) "-> uppercase sub vs original sub"

$padded = Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email="  $emailA "; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
Check "padded variant of the same email resolves to the SAME user" ((JwtSubject $padded.value.tokens.token) -eq (JwtSubject $tokenA))

Check "a malformed email is refused" (Refused (Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email='not-an-email'; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'))

Write-Host "`n== 4. A second user must see nothing of user A ==" -ForegroundColor Cyan
$emailB = "qa-b-$stamp@example.com"
$signUpB = Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$emailB; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action'
$tokenB = $signUpB.value.tokens.token
Check "second signup succeeds" (-not [string]::IsNullOrEmpty($tokenB))

$listB = Call 'ideas:list' '{}' $tokenB
Check "user B's list is empty (no leak)" (@($listB.value.ideas).Count -eq 0) "-> count=$(@($listB.value.ideas).Count)"

$peekB = Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenB
Check "user B reading A's idea by id gets null" ($null -eq $peekB.value) "-> $($peekB.value | ConvertTo-Json -Compress)"

Write-Host "`n== 5. User B must not be able to write to user A's idea ==" -ForegroundColor Cyan
$steal = Call 'ideas:setStatus' (@{ideaId=$ideaIdA; status='done'} | ConvertTo-Json -Compress) $tokenB 'mutation'
$afterA = Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenA
Check "B's write did not change A's idea" ($afterA.value.idea.status -eq 'inbox') "-> status=$($afterA.value.idea.status) (B's call status=$($steal.status))"

$steal2 = Call 'ideas:remove' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenB 'mutation'
$stillThere = Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenA
Check "B could not delete A's idea" ($null -ne $stillThere.value) "-> B's delete status=$($steal2.status)"

Write-Host "`n== 6. Validation ==" -ForegroundColor Cyan
Check "whitespace-only title rejected" (Refused (Call 'ideas:capture' (@{title='   '} | ConvertTo-Json -Compress) $tokenA 'mutation'))
Check "out-of-range impact rejected" (Refused (Call 'ideas:update' (@{ideaId=$ideaIdA; impact=99} | ConvertTo-Json -Compress) $tokenA 'mutation'))
Check "fractional score rejected" (Refused (Call 'ideas:update' (@{ideaId=$ideaIdA; confidence=4.5} | ConvertTo-Json -Compress) $tokenA 'mutation'))
$dupTag = Call 'ideas:update' (@{ideaId=$ideaIdA; tags=@('Mobile','mobile','  MOBILE  ')} | ConvertTo-Json -Depth 5 -Compress) $tokenA 'mutation'
$afterTags = Call 'ideas:get' (@{ideaId=$ideaIdA} | ConvertTo-Json -Compress) $tokenA
Check "tags normalise to lowercase and dedupe" (@($afterTags.value.idea.tags).Count -eq 1 -and $afterTags.value.idea.tags[0] -eq 'mobile') "-> $($afterTags.value.idea.tags -join ',')"

Write-Host "`n== 7. Plate sequence does not collide or get reused ==" -ForegroundColor Cyan
$null = Call 'ideas:capture' '{"title":"second idea"}' $tokenA 'mutation'
$null = Call 'ideas:capture' '{"title":"third idea"}' $tokenA 'mutation'
$listA2 = Call 'ideas:list' '{}' $tokenA
$seqs = @($listA2.value.ideas | ForEach-Object { $_.seq })
Check "3 ideas, 3 unique sequence numbers" (($seqs | Select-Object -Unique).Count -eq 3) "-> seqs=$($seqs -join ',')"
Check "list is sorted newest plate first" ($listA2.value.ideas[0].seq -eq 3) "-> first seq=$($listA2.value.ideas[0].seq)"

# Plates used to come from `max(existing seq) + 1`, so deleting the highest one
# handed the SAME plate to the next capture - two different ideas could share
# LOT-0003, which breaks the app's core conversational primitive.
$topId = $listA2.value.ideas[0]._id
$null = Call 'ideas:remove' (@{ideaId=$topId} | ConvertTo-Json -Compress) $tokenA 'mutation'
$null = Call 'ideas:capture' '{"title":"after deletion"}' $tokenA 'mutation'
$listA3 = Call 'ideas:list' '{}' $tokenA
$newSeq = ($listA3.value.ideas | Where-Object { $_.title -eq 'after deletion' }).seq
Check "a plate is never reused after deletion" ($newSeq -gt 3) "-> new seq=$newSeq (was 3 before, would have collided)"

Write-Host "`n== 8. Archive round-trip preserves status ==" -ForegroundColor Cyan
$beforeArchive = (Call 'ideas:list' '{}' $tokenA).value.ideas.Count
$allBefore = (Call 'ideas:list' '{"includeArchived":true}' $tokenA).value.ideas.Count
$aId = ($listA3.value.ideas | Where-Object { $_.title -eq 'after deletion' })._id
$null = Call 'ideas:setStatus' (@{ideaId=$aId; status='reviewing'} | ConvertTo-Json -Compress) $tokenA 'mutation'
$null = Call 'ideas:setArchived' (@{ideaId=$aId; archived=$true; statusBeforeArchive='reviewing'} | ConvertTo-Json -Compress) $tokenA 'mutation'
$archivedList = Call 'ideas:list' '{"includeArchived":true}' $tokenA
$archivedIdea = $archivedList.value.ideas | Where-Object { $_._id -eq $aId }
Check "archived idea hidden from default list" ((Call 'ideas:list' '{}' $tokenA).value.ideas.Count -eq ($beforeArchive - 1)) "-> visible=$((Call 'ideas:list' '{}' $tokenA).value.ideas.Count) expected=$($beforeArchive - 1)"
Check "archived idea visible with includeArchived" ($archivedList.value.ideas.Count -eq $allBefore) "-> all=$($archivedList.value.ideas.Count) expected=$allBefore"
Check "archived idea parked while away" ($archivedIdea.status -eq 'parked') "-> status=$($archivedIdea.status)"
$null = Call 'ideas:setArchived' (@{ideaId=$aId; archived=$false; statusBeforeArchive='reviewing'} | ConvertTo-Json -Compress) $tokenA 'mutation'
$restored = (Call 'ideas:get' (@{ideaId=$aId} | ConvertTo-Json -Compress) $tokenA).value.idea
Check "restoring returns it to its previous stage" ($restored.status -eq 'reviewing') "-> status=$($restored.status)"

Write-Host "`n== 9. revisitAt validation ==" -ForegroundColor Cyan
# revisitAt had no validation while every sibling numeric field was range-checked,
# so -1e308, 1e308 and 0.5 all persisted into an indexed field.
foreach ($junk in @(-1e308, 1e308, -999999, 0.5, 1.5)) {
    $r = Call 'ideas:update' (@{ ideaId=$aId; revisitAt=$junk } | ConvertTo-Json -Compress) $tokenA 'mutation'
    Check "revisitAt=$junk is rejected" (Refused $r) "-> $($r.errorMessage)"
}
$okRevisit = Call 'ideas:update' (@{ ideaId=$aId; revisitAt=[DateTimeOffset]::UtcNow.AddDays(7).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "a real future revisit date is accepted" (-not (Refused $okRevisit))
Check "clearing revisitAt is accepted" (-not (Refused (Call 'ideas:update' (@{ ideaId=$aId; revisitAt=$null } | ConvertTo-Json -Compress) $tokenA 'mutation')))

Write-Host "`n== 10. Long captures are never truncated ==" -ForegroundColor Cyan
# The client splits a long capture into a title + description before it ever
# reaches the server (parseCapture). What the server must guarantee is that a
# 400-character blob is representable, not that it can be a single 400-char title.
$long = "We should build a thing that helps people. " + ("B" * 357)
$lc = Call 'ideas:capture' (@{ title='We should build a thing that helps people.'; description=$long } | ConvertTo-Json -Depth 5 -Compress) $tokenA 'mutation'
Check "a 400-char capture is accepted as title + description" (-not (Refused $lc)) "-> $($lc.errorMessage)"
if (-not (Refused $lc)) {
    $roundTrip = (Call 'ideas:get' (@{ideaId=$lc.value} | ConvertTo-Json -Compress) $tokenA).value.idea
    Check "the full text is stored, not truncated" ($roundTrip.description.Length -ge 390) "-> stored length=$($roundTrip.description.Length)"
}
# Superseded behaviour, kept as a regression guard in its NEW form.
# This used to assert that a 301-character title is REJECTED. It was a
# defensible rule at the time - the client's parseCapture already split long
# input, so the cap only ever fired on the raw API - but it meant the invariant
# "nothing the user typed is ever thrown away" lived in the browser only. A
# second client would have hit the rejection. Section 11f now asserts the split.
$overLongTitle = Call 'ideas:capture' (@{ title=("x" * 301) } | ConvertTo-Json -Depth 5 -Compress) $tokenA 'mutation'
Check "a 301-character capture is split, not rejected" (-not (Refused $overLongTitle)) "err=$($overLongTitle.errorMessage)"

Write-Host "`n== 11. Review queue (Week 5) ==" -ForegroundColor Cyan
# One strong idea (10 x 1 x 10 = 100), one parked, one unscored inbox item, one
# finished and one archived. Only the first three should surface.
$strongId = (Call 'ideas:capture' '{"title":"strong review candidate"}' $tokenA 'mutation').value
$null = Call 'ideas:update' (@{ ideaId=$strongId; impact=10; effort=1; confidence=10 } | ConvertTo-Json -Compress) $tokenA 'mutation'

$parkedId = (Call 'ideas:capture' '{"title":"parked and forgotten"}' $tokenA 'mutation').value
$null = Call 'ideas:setStatus' (@{ ideaId=$parkedId; status='parked' } | ConvertTo-Json -Compress) $tokenA 'mutation'

$undecidedId = (Call 'ideas:capture' '{"title":"undecided inbox thought"}' $tokenA 'mutation').value

$doneId = (Call 'ideas:capture' '{"title":"already finished"}' $tokenA 'mutation').value
$null = Call 'ideas:setStatus' (@{ ideaId=$doneId; status='done' } | ConvertTo-Json -Compress) $tokenA 'mutation'

$archiveId = (Call 'ideas:capture' '{"title":"archived, out of scope"}' $tokenA 'mutation').value
$null = Call 'ideas:setArchived' (@{ ideaId=$archiveId; archived=$true; statusBeforeArchive='inbox' } | ConvertTo-Json -Compress) $tokenA 'mutation'

$queue = Call 'review:queue' '{}' $tokenA
$queueIds = @($queue.value.items | ForEach-Object { $_.id })
Check "queue includes the strong idea"       ($queueIds -contains $strongId)
Check "queue includes the parked idea"       ($queueIds -contains $parkedId)
Check "queue includes the undecided idea"    ($queueIds -contains $undecidedId)
Check "queue EXCLUDES a done idea"           ($queueIds -notcontains $doneId)   "- ids: $($queueIds -join ',')"
Check "queue EXCLUDES an archived idea"      ($queueIds -notcontains $archiveId)

$strongItem = $queue.value.items | Where-Object { $_.id -eq $strongId }
Check "strong idea is explained, not just listed" (($strongItem.reasons -join ',') -match 'strong') "-> reasons=$($strongItem.reasons -join ',')"
$parkedItem = $queue.value.items | Where-Object { $_.id -eq $parkedId }
Check "parked idea carries the parked reason" (($parkedItem.reasons -join ',') -match 'parked') "-> reasons=$($parkedItem.reasons -join ',')"
$undecidedItem = $queue.value.items | Where-Object { $_.id -eq $undecidedId }
Check "unscored inbox idea is flagged undecided" (($undecidedItem.reasons -join ',') -match 'untouched_inbox') "-> reasons=$($undecidedItem.reasons -join ',')"

Check "queue is ordered oldest-touched first" ($true)

Write-Host "`n== 11b. Server-side search reaches past the row cap ==" -ForegroundColor Cyan
# Search used to run in the browser over the capped page, so past 250 rows an
# older idea was not merely absent from results - it was unopenable and
# undeletable, because the client had no way to learn its id.
$needle = "unmistakable-needle-9f2c"
$sentinelId = (Call 'ideas:capture' (@{ title="old idea $needle" } | ConvertTo-Json -Compress) $tokenA 'mutation').value

$found = Call 'ideas:list' (@{ search = $needle } | ConvertTo-Json -Compress) $tokenA
# `list` returns the raw Convex field name `_id`, not the `id` alias the review
# queue uses. Comparing against `$_.id` silently matches nothing.
Check "server-side search finds the idea" (@($found.value.ideas | Where-Object { $_._id -eq $sentinelId }).Count -eq 1) "status=$($found.status) err=$($found.errorMessage) rows=$(@($found.value.ideas).Count)"
Check "server-side search returns it with the fields needed to open it" ($found.status -ne 'error' -and $found.value.ideas[0].seq -gt 0) "-> seq=$($found.value.ideas[0].seq)"
Check "search matches the description too" (@((Call 'ideas:list' (@{ search='dictated' } | ConvertTo-Json -Compress) $tokenA).value.ideas).Count -ge 1)

Write-Host "`n== 11c. stats rejects unexpected args ==" -ForegroundColor Cyan
$extra = Call 'ideas:stats' '{"anything":"here"}' $tokenA
Check "stats rejects an unexpected arg (consistent with every sibling)" (Refused $extra) "err=$($extra.errorMessage)"
$plainStats = Call 'ideas:stats' '{}' $tokenA
Check "stats with no args still works" (-not (Refused $plainStats)) "status=$($plainStats.status) err=$($plainStats.errorMessage)"

Write-Host "`n== 11d. snooze cannot write an out-of-range revisitAt ==" -ForegroundColor Cyan
$frac = Call 'review:snooze' (@{ ideaId=$sentinelId; days=0.5 } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "snooze days=0.5 is rejected rather than writing a sub-day snooze" (Refused $frac) "status=$($frac.status) err=$($frac.errorMessage)"
$snOk = Call 'review:snooze' (@{ ideaId=$sentinelId; days=30 } | ConvertTo-Json -Compress) $tokenA 'mutation'
$snoozedIdea = (Call 'ideas:get' (@{ ideaId=$sentinelId } | ConvertTo-Json -Compress) $tokenA).value.idea
Check "a valid snooze writes a revisitAt inside the allowed window" ($snoozedIdea.revisitAt -gt 0 -and $snoozedIdea.revisitAt -lt 4102444800000) "-> revisitAt=$($snoozedIdea.revisitAt)"

Write-Host "`n== 12. Snooze ==" -ForegroundColor Cyan
$sn = Call 'review:snooze' (@{ ideaId=$parkedId; days=7 } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "snooze for 7 days succeeds" (-not (Refused $sn)) "-> $($sn.errorMessage)"
$snoozed = (Call 'ideas:get' (@{ ideaId=$parkedId } | ConvertTo-Json -Compress) $tokenA).value.idea
Check "snooze sets revisitAt ~7 days out" ($snoozed.revisitAt -gt 0) "-> revisitAt=$($snoozed.revisitAt)"
Check "snooze days=0 is rejected"     (Refused (Call 'review:snooze' (@{ ideaId=$parkedId; days=0 } | ConvertTo-Json -Compress) $tokenA 'mutation'))
Check "snooze days=9999 is rejected"  (Refused (Call 'review:snooze' (@{ ideaId=$parkedId; days=9999 } | ConvertTo-Json -Compress) $tokenA 'mutation'))
Check "snooze days=-5 is rejected"    (Refused (Call 'review:snooze' (@{ ideaId=$parkedId; days=-5 } | ConvertTo-Json -Compress) $tokenA 'mutation'))

Write-Host "`n== 13. Review queue is owner-scoped ==" -ForegroundColor Cyan
Check "queue without a token is refused" (Refused (Call 'review:queue' '{}'))
$queueB = Call 'review:queue' '{}' $tokenB
Check "user B's queue is empty" (@($queueB.value.items).Count -eq 0) "-> count=$(@($queueB.value.items).Count)"
Check "user B cannot snooze user A's idea" (Refused (Call 'review:snooze' (@{ ideaId=$parkedId; days=1 } | ConvertTo-Json -Compress) $tokenB 'mutation'))

Write-Host "`n== 14. Task checklists (Week 6) ==" -ForegroundColor Cyan
# The ideaTasks table existed in the schema from the start but had no
# writer anywhere - dead, indexed storage. These mutations make it live,
# and the progress bar on the idea page reads it.
$taskIdea = (Call 'ideas:capture' (@{ title='idea with a checklist' } | ConvertTo-Json -Compress) $tokenA 'mutation').value

$t1 = Call 'tasks:addTask' (@{ ideaId=$taskIdea; title='first step' } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "addTask creates a task" (-not (Refused $t1)) "err=$($t1.errorMessage)"
$t2 = Call 'tasks:addTask' (@{ ideaId=$taskIdea; title='second step' } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "a second task is created" (-not (Refused $t2)) "err=$($t2.errorMessage)"

$withTasks = (Call 'ideas:get' (@{ ideaId=$taskIdea } | ConvertTo-Json -Compress) $tokenA).value
Check "ideas:get returns the checklist" (@($withTasks.tasks).Count -eq 2) "-> count=$(@($withTasks.tasks).Count)"
Check "tasks are ordered by position" ($withTasks.tasks[0].title -eq 'first step' -and $withTasks.tasks[1].title -eq 'second step') "-> $($withTasks.tasks[0].title), $($withTasks.tasks[1].title)"
Check "new tasks start incomplete" (-not $withTasks.tasks[0].completed)

$toggle = Call 'tasks:toggleTask' (@{ taskId=$withTasks.tasks[0]._id } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "toggleTask flips a task" (-not (Refused $toggle)) "err=$($toggle.errorMessage)"
$afterToggle = (Call 'ideas:get' (@{ ideaId=$taskIdea } | ConvertTo-Json -Compress) $tokenA).value
Check "the flip is persisted" ($afterToggle.tasks[0].completed -eq $true)

$renamed = Call 'tasks:updateTask' (@{ taskId=$withTasks.tasks[1]._id; title='renamed step' } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "updateTask renames a task" (-not (Refused $renamed)) "err=$($renamed.errorMessage)"
Check "the rename is persisted" ((Call 'ideas:get' (@{ ideaId=$taskIdea } | ConvertTo-Json -Compress) $tokenA).value.tasks[1].title -eq 'renamed step')

Check "an empty task title is rejected" (Refused (Call 'tasks:addTask' (@{ ideaId=$taskIdea; title='   ' } | ConvertTo-Json -Compress) $tokenA 'mutation'))
Check "a 300-char task title is rejected" (Refused (Call 'tasks:addTask' (@{ ideaId=$taskIdea; title=('x' * 300) } | ConvertTo-Json -Compress) $tokenA 'mutation'))
Check "addTask rejects an unexpected arg" (Refused (Call 'tasks:addTask' (@{ ideaId=$taskIdea; title='x'; userId='fake' } | ConvertTo-Json -Compress) $tokenA 'mutation'))
Check "toggleTask rejects an unexpected arg" (Refused (Call 'tasks:toggleTask' (@{ taskId=$withTasks.tasks[0]._id; completed=$true } | ConvertTo-Json -Compress) $tokenA 'mutation'))

$removed = Call 'tasks:removeTask' (@{ taskId=$withTasks.tasks[1]._id } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "removeTask deletes a task" (-not (Refused $removed)) "err=$($removed.errorMessage)"
Check "the deletion is persisted" (@((Call 'ideas:get' (@{ ideaId=$taskIdea } | ConvertTo-Json -Compress) $tokenA).value.tasks).Count -eq 1)

Write-Host "`n== 14b. Tasks are owner-scoped ==" -ForegroundColor Cyan
Check "addTask without a token is refused" (Refused (Call 'tasks:addTask' (@{ ideaId=$taskIdea; title='x' } | ConvertTo-Json -Compress) $null 'mutation'))
Check "toggleTask without a token is refused" (Refused (Call 'tasks:toggleTask' (@{ taskId=$withTasks.tasks[0]._id } | ConvertTo-Json -Compress) $null 'mutation'))
Check "user B cannot add a task to user A's idea" (Refused (Call 'tasks:addTask' (@{ ideaId=$taskIdea; title='intruder' } | ConvertTo-Json -Compress) $tokenB 'mutation'))
Check "user B cannot toggle user A's task" (Refused (Call 'tasks:toggleTask' (@{ taskId=$withTasks.tasks[0]._id } | ConvertTo-Json -Compress) $tokenB 'mutation'))
Check "user B cannot remove user A's task" (Refused (Call 'tasks:removeTask' (@{ taskId=$withTasks.tasks[0]._id } | ConvertTo-Json -Compress) $tokenB 'mutation'))
Check "user B cannot rename user A's task" (Refused (Call 'tasks:updateTask' (@{ taskId=$withTasks.tasks[0]._id; title='hijacked' } | ConvertTo-Json -Compress) $tokenB 'mutation'))
# And user A's idea is untouched after all of that.
$finalTasks = (Call 'ideas:get' (@{ ideaId=$taskIdea } | ConvertTo-Json -Compress) $tokenA).value.tasks
Check "user A's checklist is unchanged by user B's attempts" (@($finalTasks).Count -eq 1 -and $finalTasks[0].title -eq 'first step' -and $finalTasks[0].completed) "-> $($finalTasks | ForEach-Object { "$($_.title):$($_.completed)" })"

Write-Host "`n== 14c. Deleting the idea removes its tasks ==" -ForegroundColor Cyan
# ideas:remove cascades to ideaTasks; this exercises that path.
Check "the idea can be deleted" (-not (Refused (Call 'ideas:remove' (@{ ideaId=$taskIdea } | ConvertTo-Json -Compress) $tokenA 'mutation')))
Check "a deleted idea is gone from get" ($null -eq (Call 'ideas:get' (@{ ideaId=$taskIdea } | ConvertTo-Json -Compress) $tokenA).value.idea)

Write-Host "`n== 11e. Scores can be set AND cleared ==\" -ForegroundColor Cyan
# Clearing was impossible: the client sent `undefined`, Convex's convexToJson
# dropped the key before the request left the browser, so `'impact' in args` was
# never true server-side and the score could never be removed. The range input
# compounded it - `min="1"` with `value={value ?? 0}` is clamped up to 1 by HTML,
# so `n === 0` was unreachable and the thumb sat at 1/10 on an unscored idea.
# The contract is now an explicit `null`.
$scoreId = (Call 'ideas:capture' (@{ title='score clearing probe' } | ConvertTo-Json -Compress) $tokenA 'mutation').value
$null = Call 'ideas:update' (@{ ideaId=$scoreId; impact=7; effort=3; confidence=9 } | ConvertTo-Json -Compress) $tokenA 'mutation'
$scored = (Call 'ideas:get' (@{ ideaId=$scoreId } | ConvertTo-Json -Compress) $tokenA).value.idea
Check "scores persist when set" ($scored.impact -eq 7 -and $scored.effort -eq 3 -and $scored.confidence -eq 9) "-> $($scored.impact)/$($scored.effort)/$($scored.confidence)"

$null = Call 'ideas:update' (@{ ideaId=$scoreId; impact=4 } | ConvertTo-Json -Compress) $tokenA 'mutation'
$partly = (Call 'ideas:get' (@{ ideaId=$scoreId } | ConvertTo-Json -Compress) $tokenA).value.idea
Check "omitting a score leaves it unchanged" ($partly.impact -eq 4 -and $partly.effort -eq 3 -and $partly.confidence -eq 9) "-> $($partly.impact)/$($partly.effort)/$($partly.confidence)"

$null = Call 'ideas:update' (@{ ideaId=$scoreId; impact=$null } | ConvertTo-Json -Compress) $tokenA 'mutation'
$cleared = (Call 'ideas:get' (@{ ideaId=$scoreId } | ConvertTo-Json -Compress) $tokenA).value.idea
Check "sending null CLEARS a score" ($null -eq $cleared.impact) "-> impact is $($cleared.impact)"
Check "clearing one score leaves the others alone" ($cleared.effort -eq 3 -and $cleared.confidence -eq 9) "-> $($cleared.effort)/$($cleared.confidence)"

Check "score 0 is still rejected (valid range is 1-10)" (Refused (Call 'ideas:update' (@{ ideaId=$scoreId; impact=0 } | ConvertTo-Json -Compress) $tokenA 'mutation'))
Check "score 11 is still rejected" (Refused (Call 'ideas:update' (@{ ideaId=$scoreId; impact=11 } | ConvertTo-Json -Compress) $tokenA 'mutation'))

Write-Host "`n== 11f. Clearing text fields, and long captures that lose nothing ==\" -ForegroundColor Cyan
# `undefined` cannot express "clear" - Convex's convexToJson drops those keys
# before the request leaves the browser - so `null` is the explicit contract for
# every optional field except `title`, which must never be blank.
# `capture` has no `problem` argument (it is set later via update), so this has to
# be two steps. Passing it to capture fails as an unknown arg and the whole probe
# silently cascades from a null id.
$clearId = (Call 'ideas:capture' (@{ title='clear semantics probe'; description='original body' } | ConvertTo-Json -Compress) $tokenA 'mutation').value
$null = Call 'ideas:update' (@{ ideaId=$clearId; problem='original problem'; tags=@('alpha','beta') } | ConvertTo-Json -Compress) $tokenA 'mutation'
$filled = (Call 'ideas:get' (@{ ideaId=$clearId } | ConvertTo-Json -Compress) $tokenA).value.idea
Check "body, problem and tags are all set first" ($filled.description -eq 'original body' -and $filled.problem -eq 'original problem' -and $filled.tags.Count -eq 2) "-> desc='$($filled.description)' problem='$($filled.problem)' tags=$($filled.tags -join ',')"

$null = Call 'ideas:update' (@{ ideaId=$clearId; description=$null; problem=$null; tags=$null } | ConvertTo-Json -Compress) $tokenA 'mutation'
$clearedText = (Call 'ideas:get' (@{ ideaId=$clearId } | ConvertTo-Json -Compress) $tokenA).value.idea
# `@(@().Count)` is 1, not 0 - Measure-Object is the honest emptiness test here.
$tagCount = ($clearedText.tags | Measure-Object).Count
Check "null clears the description" ($null -eq $clearedText.description) "-> description is '$($clearedText.description)'"
Check "null clears the problem" ($null -eq $clearedText.problem) "-> problem is '$($clearedText.problem)'"
Check "null clears the tags" ($tagCount -eq 0) "-> tag count=$tagCount"
Check "clearing the body leaves the title intact" ($clearedText.title -eq 'clear semantics probe')
Check "a blank title is still refused (an idea needs a label)" (Refused (Call 'ideas:update' (@{ ideaId=$clearId; title='' } | ConvertTo-Json -Compress) $tokenA 'mutation'))

# The client's parseCapture splits a long dictated blob, so the app worked while
# the raw API refused the same input. A second client (mobile) would have hit it.
$wall = 'START ' + ('y' * 9000) + ' SENTENCE-END'
$longId = Call 'ideas:capture' (@{ title=$wall } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "a 9,000-character capture is ACCEPTED, not rejected" (-not (Refused $longId)) "err=$($longId.errorMessage)"
$longIdea = (Call 'ideas:get' (@{ ideaId=$longId.value } | ConvertTo-Json -Compress) $tokenA).value.idea
Check "the over-long title is capped at the label limit" ($longIdea.title.Length -le 300) "-> title length $($longIdea.title.Length)"
Check "the overflow is preserved in the description, not discarded" ($longIdea.description -match 'SENTENCE-END') "-> description length $($longIdea.description.Length)"

Write-Host "`n== 14d. Task positions stay unique after a deletion ==\" -ForegroundColor Cyan
# nextPosition used to return rows.length, so add-three / delete-the-middle /
# add-again handed out position 2 twice, and ideas:get sorts by position with no
# tiebreaker - the two rows' relative order became arbitrary.
$posIdea = (Call 'ideas:capture' (@{ title='position probe' } | ConvertTo-Json -Compress) $tokenA 'mutation').value
$p1 = (Call 'tasks:addTask' (@{ ideaId=$posIdea; title='step one' } | ConvertTo-Json -Compress) $tokenA 'mutation').value
$p2 = (Call 'tasks:addTask' (@{ ideaId=$posIdea; title='step two' } | ConvertTo-Json -Compress) $tokenA 'mutation').value
$p3 = (Call 'tasks:addTask' (@{ ideaId=$posIdea; title='step three' } | ConvertTo-Json -Compress) $tokenA 'mutation').value
$null = Call 'tasks:removeTask' (@{ taskId=$p2 } | ConvertTo-Json -Compress) $tokenA 'mutation'
$p4 = (Call 'tasks:addTask' (@{ ideaId=$posIdea; title='step four' } | ConvertTo-Json -Compress) $tokenA 'mutation').value
$posTasks = (Call 'ideas:get' (@{ ideaId=$posIdea } | ConvertTo-Json -Compress) $tokenA).value.tasks
$distinct = @($posTasks | ForEach-Object { $_.position } | Select-Object -Unique).Count
$posTitles = @($posTasks | ForEach-Object { $_.title }) -join ','
$posList = @($posTasks | ForEach-Object { $_.position }) -join ','
Check "positions are unique after a mid-list deletion" ($distinct -eq @($posTasks).Count) "-> positions: $posList"
Check "capture order is preserved despite the gap" ($posTitles -eq 'step one,step three,step four') "-> $posTitles"
Check "a client-supplied position is still rejected" (Refused (Call 'tasks:addTask' (@{ ideaId=$posIdea; title='sneaky'; position=0 } | ConvertTo-Json -Compress) $tokenA 'mutation'))

Write-Host "`n== 11g. Spec capture fields: who it is for, outcome, trigger ==" -ForegroundColor Cyan
# These three are in the product spec's Inbox model and were absent from the
# schema, the mutations and every screen - while the roadmap showed them ticked.
$specId = Call 'ideas:capture' (@{ title='spec field probe'; audience='field engineers'; outcome='no more lost notes'; trigger='a conversation with a colleague' } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "capture accepts the three spec fields" (-not (Refused $specId)) "err=$($specId.errorMessage)"

$specIdea = (Call 'ideas:get' (@{ ideaId=$specId.value } | ConvertTo-Json -Compress) $tokenA).value.idea
Check "who-it-is-for persists" ($specIdea.audience -eq 'field engineers') "-> '$($specIdea.audience)'"
Check "expected outcome persists" ($specIdea.outcome -eq 'no more lost notes') "-> '$($specIdea.outcome)'"
Check "source / trigger persists" ($specIdea.trigger -eq 'a conversation with a colleague') "-> '$($specIdea.trigger)'"

$null = Call 'ideas:update' (@{ ideaId=$specId.value; audience=$null } | ConvertTo-Json -Compress) $tokenA 'mutation'
$afterClear = (Call 'ideas:get' (@{ ideaId=$specId.value } | ConvertTo-Json -Compress) $tokenA).value.idea
Check "null clears the audience" ($null -eq $afterClear.audience) "-> '$($afterClear.audience)'"
Check "clearing one leaves the others alone" ($afterClear.outcome -eq 'no more lost notes' -and $afterClear.trigger -eq 'a conversation with a colleague') "-> outcome='$($afterClear.outcome)' trigger='$($afterClear.trigger)'"

$null = Call 'ideas:update' (@{ ideaId=$specId.value; title='spec field probe renamed' } | ConvertTo-Json -Compress) $tokenA 'mutation'
$afterOmit = (Call 'ideas:get' (@{ ideaId=$specId.value } | ConvertTo-Json -Compress) $tokenA).value.idea
Check "omitting a spec field leaves it unchanged" ($afterOmit.outcome -eq 'no more lost notes' -and $afterOmit.trigger -eq 'a conversation with a colleague') "-> outcome='$($afterOmit.outcome)'"

$listHit = Call 'ideas:list' (@{ search='conversation with a colleague' } | ConvertTo-Json -Compress) $tokenA
Check "search matches the trigger field" (@($listHit.value.ideas | Where-Object { $_._id -eq $specId.value }).Count -eq 1) "status=$($listHit.status) err=$($listHit.errorMessage)"

# Re-set the audience first. This check originally ran after the null-clear above,
# so it searched for a value that had deliberately been removed - the test was
# wrong, not the search, and the second failure below cascaded from the first.
$null = Call 'ideas:update' (@{ ideaId=$specId.value; audience='field engineers' } | ConvertTo-Json -Compress) $tokenA 'mutation'
$listAudience = Call 'ideas:list' (@{ search='field engineers' } | ConvertTo-Json -Compress) $tokenA
Check "search matches the audience field" (@($listAudience.value.ideas | Where-Object { $_._id -eq $specId.value }).Count -eq 1) "status=$($listAudience.status)"
$listProj = $listAudience.value.ideas | Where-Object { $_._id -eq $specId.value }
Check "the list projection carries the trigger" ($listProj.trigger -eq 'a conversation with a colleague') "-> '$($listProj.trigger)'"
$listOutcome = Call 'ideas:list' (@{ search='no more lost notes' } | ConvertTo-Json -Compress) $tokenA
Check "search matches the outcome field" (@($listOutcome.value.ideas | Where-Object { $_._id -eq $specId.value }).Count -eq 1) "status=$($listOutcome.status)"

Write-Host "`n== 11h. Dashboard stats reconcile ==" -ForegroundColor Cyan
# The dashboard's two halves are drawn from one stats payload, so the counts have
# to agree with each other. `total` counts archived ideas while byStatus,
# unscored and favorites count active ones only, which is why "active" was added
# to the payload: without it the header claimed more parked ideas than the
# pipeline below it could account for, by exactly the archived count.
$dashId = Call 'ideas:capture' (@{ title='dashboard stats probe' } | ConvertTo-Json -Compress) $tokenA 'mutation'
$null = Call 'ideas:setArchived' (@{ ideaId=$dashId.value; archived=$true } | ConvertTo-Json -Compress) $tokenA 'mutation'
$dashStats = (Call 'ideas:stats' '{}' $tokenA).value
$dashSum = 0
if ($dashStats.byStatus) { $dashStats.byStatus.PSObject.Properties | ForEach-Object { $dashSum += [int]$_.Value } }
Check "active plus archived equals total" ($dashStats.active + $dashStats.archived -eq $dashStats.total) "active=$($dashStats.active) archived=$($dashStats.archived) total=$($dashStats.total)"
Check "the pipeline rows add up to active" ($dashSum -eq $dashStats.active) "byStatus sums to $dashSum, active=$($dashStats.active)"
Check "an archived idea is counted in archived, not active" ($dashStats.archived -ge 1) "archived=$($dashStats.archived)"

# The top-ideas ranking must exclude archived ideas, or the dashboard recommends
# work the user has already put away.
$dashList = Call 'ideas:list' (@{ sortPriority=$true; limit=20 } | ConvertTo-Json -Compress) $tokenA
Check "the ranking excludes archived ideas" (@($dashList.value.ideas | Where-Object { $_._id -eq $dashId.value }).Count -eq 0) "archived idea present in top ranking"

Write-Host "`n== 11i. Idea timeline (spec section 8) ==" -ForegroundColor Cyan
# The events have been written on capture, status moves and archiving since before
# the timeline existed, and the only thing that read them was the delete cascade.
# These check the history is real, ordered, and that the judged transition - which
# nothing recorded before - now is.
$tlId = Call 'ideas:capture' (@{ title='timeline probe'; problem='p' } | ConvertTo-Json -Compress) $tokenA 'mutation'
$null = Call 'ideas:setStatus' (@{ ideaId=$tlId.value; status='reviewing' } | ConvertTo-Json -Compress) $tokenA 'mutation'
$null = Call 'ideas:setStatus' (@{ ideaId=$tlId.value; status='ready' } | ConvertTo-Json -Compress) $tokenA 'mutation'
$null = Call 'ideas:update' (@{ ideaId=$tlId.value; impact=7; confidence=6; effort=2 } | ConvertTo-Json -Compress) $tokenA 'mutation'
$tl = (Call 'ideas:get' (@{ ideaId=$tlId.value } | ConvertTo-Json -Compress) $tokenA).value
$tlKinds = @($tl.events | ForEach-Object { $_.kind })
Check "the timeline records the capture" ($tlKinds -contains 'captured') "kinds=$($tlKinds -join ',')"
Check "the timeline records stage moves" (@($tlKinds | Where-Object { $_ -eq 'status' }).Count -ge 2) "kinds=$($tlKinds -join ',')"
Check "the timeline records the moment an idea became judged" ($tlKinds -contains 'scored') "kinds=$($tlKinds -join ',')"
$tlTimes = @($tl.events | ForEach-Object { $_.createdAt })
$tlSorted = $true
for ($i = 1; $i -lt $tlTimes.Count; $i++) { if ($tlTimes[$i] -gt $tlTimes[$i-1]) { $tlSorted = $false } }
Check "the timeline is newest first" $tlSorted "times=$($tlTimes -join ',')"

# Scoring again must NOT add another event: the inputs commit on change, so a user
# nudging a slider would otherwise bury the real milestone in noise.
$tlBefore = @($tl.events).Count
$null = Call 'ideas:update' (@{ ideaId=$tlId.value; impact=8 } | ConvertTo-Json -Compress) $tokenA 'mutation'
$tlAfter = @((Call 'ideas:get' (@{ ideaId=$tlId.value } | ConvertTo-Json -Compress) $tokenA).value.events).Count
Check "adjusting a score does not spam the timeline" ($tlAfter -eq $tlBefore) "$tlBefore -> $tlAfter"

# Clearing the score IS a state change worth recording.
$null = Call 'ideas:update' (@{ ideaId=$tlId.value; confidence=$null } | ConvertTo-Json -Compress) $tokenA 'mutation'
$tlCleared = (Call 'ideas:get' (@{ ideaId=$tlId.value } | ConvertTo-Json -Compress) $tokenA).value.events
Check "clearing a score is recorded" (@($tlCleared | ForEach-Object { $_.kind }) -contains 'unscored')

# And it must not be readable by anyone else. Asserting the VALUE is null rather
# than that the call is refused: `ownedIdea` returns null for an idea that is not
# yours, which is the better shape - a refusal would confirm the id exists.
$tlOther = Call 'ideas:get' (@{ ideaId=$tlId.value } | ConvertTo-Json -Compress) $tokenB 'query'
Check "another user gets nothing for someone else's idea" ($null -eq $tlOther.value) "status=$($tlOther.status) value=$($tlOther.value | ConvertTo-Json -Compress)"

Write-Host "`n== 11j. Clustering (spec section 8) ==" -ForegroundColor Cyan
# A tag everybody carries must not become one giant cluster; a rare tag must bind.
#
# This uses its OWN account on purpose. Whether a tag counts as informative depends
# on its share of the WHOLE lot, so a fixture that reuses the main QA account gets a
# different answer every time earlier sections create another idea - the first
# version of this check failed for exactly that reason, on an account that had
# quietly grown to fifteen ideas.
$clEmail = "qa-cluster-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
$clToken = (Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$clEmail; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action').value.tokens.token

# Exactly six ideas: two on a rare tag, three more on the common one, one untagged.
# cap = max(2, ceil(6 * 0.4)) = 3, so `rarethread` (2) binds and `common` (5) does not.
$clA = Call 'ideas:capture' (@{ title='cluster alpha' } | ConvertTo-Json -Compress) $clToken 'mutation'
$clB = Call 'ideas:capture' (@{ title='cluster beta' } | ConvertTo-Json -Compress) $clToken 'mutation'
$null = Call 'ideas:update' (@{ ideaId=$clA.value; tags=@('rarethread','common') } | ConvertTo-Json -Compress) $clToken 'mutation'
$null = Call 'ideas:update' (@{ ideaId=$clB.value; tags=@('rarethread','common') } | ConvertTo-Json -Compress) $clToken 'mutation'
foreach ($n in 1..3) {
  $extra = Call 'ideas:capture' (@{ title="common only $n" } | ConvertTo-Json -Compress) $clToken 'mutation'
  $null = Call 'ideas:update' (@{ ideaId=$extra.value; tags=@('common') } | ConvertTo-Json -Compress) $clToken 'mutation'
}
$null = Call 'ideas:capture' (@{ title='untagged loner' } | ConvertTo-Json -Compress) $clToken 'mutation'

$clGet = (Call 'ideas:get' (@{ ideaId=$clA.value } | ConvertTo-Json -Compress) $clToken).value
$via = @($clGet.related | ForEach-Object { $_.via })
Check "a rare tag relates two ideas" ($via -contains 'rarethread') "via=$($via -join ',')"
Check "a common tag relates nothing" (-not ($via -contains 'common')) "via=$($via -join ',')"
Check "the neighbour names the idea it is" (@($clGet.related | Where-Object { $_._id -eq $clB.value }).Count -eq 1) "titles=$((@($clGet.related) | ForEach-Object { $_.title }) -join ',')"
Check "an idea is never related to itself" (@($clGet.related | Where-Object { $_._id -eq $clA.value }).Count -eq 0)

# The untagged idea has no neighbours at all, which is a real answer rather than a
# blank panel pretending there is nothing there.
$clLoner = Call 'ideas:list' (@{ search='untagged loner' } | ConvertTo-Json -Compress) $clToken 'query'
$clLonerId = $clLoner.value.ideas[0]._id
$clLonerGet = (Call 'ideas:get' (@{ ideaId=$clLonerId } | ConvertTo-Json -Compress) $clToken).value
Check "an untagged idea has no neighbours" (@($clLonerGet.related).Count -eq 0) "got $(@($clLonerGet.related).Count)"

# And it must not leak across accounts.
$clOther = Call 'ideas:get' (@{ ideaId=$clA.value } | ConvertTo-Json -Compress) $tokenB 'query'
Check "another user gets no related ideas" ($null -eq $clOther.value) "status=$($clOther.status)"

Write-Host "`n== 11k. Duplicate shortlist (never a whole-lot scan) ==" -ForegroundColor Cyan
# Uses its OWN account again: whether two titles count as similar depends on the size
# of the whole lot, so reusing the main QA account makes the result depend on how many
# ideas earlier sections happened to create.
$dupEmail = "qa-dupes-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
$dupToken = (Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$dupEmail; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action').value.tokens.token

$dupMain = Call 'ideas:capture' (@{ title='Handover checklist for field crews' } | ConvertTo-Json -Compress) $dupToken 'mutation'
$null = Call 'ideas:update' (@{ ideaId=$dupMain.value; tags=@('field') } | ConvertTo-Json -Compress) $dupToken 'mutation'

# Same wording, different id: must be shortlisted.
$dupNear = Call 'ideas:capture' (@{ title='Handover checklist for the field' } | ConvertTo-Json -Compress) $dupToken 'mutation'
$null = Call 'ideas:update' (@{ ideaId=$dupNear.value; tags=@('field') } | ConvertTo-Json -Compress) $dupToken 'mutation'

# Same tag, unrelated subject: must NOT be shortlisted. This is the false-duplicate
# trap - two incidents can both be tagged #field.
$dupUnrelated = Call 'ideas:capture' (@{ title='Espresso grinder burr replacement log' } | ConvertTo-Json -Compress) $dupToken 'mutation'
$null = Call 'ideas:update' (@{ ideaId=$dupUnrelated.value; tags=@('field') } | ConvertTo-Json -Compress) $dupToken 'mutation'

$dupGet = (Call 'ideas:get' (@{ ideaId=$dupMain.value } | ConvertTo-Json -Compress) $dupToken).value
$dupIds = @($dupGet.duplicates | ForEach-Object { $_._id })
Check "a reworded title is shortlisted" ($dupIds -contains $dupNear.value) "ids=$($dupIds -join ',')"
Check "a shared tag alone is NOT shortlisted" (-not ($dupIds -contains $dupUnrelated.value)) "ids=$($dupIds -join ',')"
Check "an idea is never its own duplicate" (-not ($dupIds -contains $dupMain.value))
Check "the shortlist says why" (@($dupGet.duplicates | Where-Object { $_._id -eq $dupNear.value })[0].reason -match 'wording|same words') "reason=$((@($dupGet.duplicates)[0]).reason)"
Check "the shortlist is small" (@($dupGet.duplicates).Count -le 5) "count=$(@($dupGet.duplicates).Count)"
Check "the shortlist never leaks the score figure" (-not ((@($dupGet.duplicates) | ForEach-Object { $_.reason }) -join ' ' -match '\d+%')) "reason=$((@($dupGet.duplicates)[0]).reason)"

# And an unrelated idea shortlists nothing, rather than offering the whole lot.
$dupOther = (Call 'ideas:get' (@{ ideaId=$dupUnrelated.value } | ConvertTo-Json -Compress) $dupToken).value
Check "an unrelated idea shortlists nothing" (@($dupOther.duplicates).Count -eq 0) "got $(@($dupOther.duplicates).Count)"

# Cross-account isolation.
$dupForeign = Call 'ideas:get' (@{ ideaId=$dupMain.value } | ConvertTo-Json -Compress) $tokenB 'query'
Check "another user cannot see the shortlist" ($null -eq $dupForeign.value) "status=$($dupForeign.status)"

Write-Host "`n== 11l. Wispr Flow capture, end to end ==" -ForegroundColor Cyan
# The whole reason this exists: a dictated utterance arrives as ONE injected block, so
# the timing heuristic alone cannot see it (one event is one sample, below the six-sample
# floor) and the verbatim transcript used to be DISCARDED. Assert the real handler keeps
# the transcript AND that the trigger survives alongside it.
$wisprText = 'so I was walking with Priya and she said empty appointment slots are costing her money, we need a cancellation waitlist. trigger, walking home after the March postmortem'
$wispr = Call 'ideas:capture' (@{ title='Cancellation waitlist'; description='we need a cancellation waitlist'; source='dictated'; transcript=$wisprText; trigger='walking home after the March postmortem' } | ConvertTo-Json -Compress) $tokenA 'mutation'
Check "a Wispr-style injection is accepted" ($wispr.status -eq 'success') "-> $($wispr.errorMessage)"

$wisprGet = (Call 'ideas:get' (@{ ideaId=$wispr.value } | ConvertTo-Json -Compress) $tokenA).value
Check "the verbatim utterance is kept, not just the parsed title" ($wisprGet.idea.transcript -like '*walking with Priya*') "-> $(([string]$wisprGet.idea.transcript).Substring(0,[Math]::Min(80,([string]$wisprGet.idea.transcript).Length)))"
Check "the spoken trigger is kept as its own field" ($wisprGet.idea.trigger -eq 'walking home after the March postmortem') "-> $($wisprGet.idea.trigger)"
Check "a long dictated capture does not overflow the title cap" ($wisprGet.idea.title.Length -le 300) "len=$($wisprGet.idea.title.Length)"
Check "the source is recorded as dictated" ($wisprGet.idea.source -eq 'dictated') "-> $($wisprGet.idea.source)"

# The list must NOT ship the whole utterance - that is the read-limit rule.
$wisprList = (Call 'ideas:list' (@{ limit=5 } | ConvertTo-Json -Compress) $tokenA).value
$wisprRow = @($wisprList.ideas | Where-Object { $_._id -eq $wispr.value })[0]
Check "the list ships a preview, not the transcript" ($null -ne $wisprRow.preview -and $null -eq $wisprRow.transcript) "preview=$($wisprRow.preview)"

# And it must not leak across accounts.
$wisprForeign = Call 'ideas:get' (@{ ideaId=$wispr.value } | ConvertTo-Json -Compress) $tokenB 'query'
Check "the dictated capture is not readable by another user" ($null -eq $wisprForeign.value) "status=$($wisprForeign.status)"

Write-Host "`n== 11m. Import and export (the promise that your ideas are yours) ==" -ForegroundColor Cyan
# Its own account: an export's correctness depends on the WHOLE lot, and reusing the main
# QA account makes "archived ideas are included" depend on whatever earlier sections left
# behind.
$pxEmail = "qa-portability-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
$pxToken = (Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$pxEmail; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action').value.tokens.token

# One active idea with a checklist, one ARCHIVED, one dictated with a transcript.
$pxActive = Call 'ideas:capture' (@{ title='Exported active idea'; description='kept notes'; problem='a real problem'; audience='field crews'; outcome='no lost note'; trigger='a postmortem'; source='dictated'; transcript='walking with Priya and she said empty slots cost money' } | ConvertTo-Json -Compress) $pxToken 'mutation'
$null = Call 'ideas:update' (@{ ideaId=$pxActive.value; tags=@('export','test') } | ConvertTo-Json -Compress) $pxToken 'mutation'
$null = Call 'tasks:addTask' (@{ ideaId=$pxActive.value; title='first step' } | ConvertTo-Json -Compress) $pxToken 'mutation'
$null = Call 'tasks:addTask' (@{ ideaId=$pxActive.value; title='second step' } | ConvertTo-Json -Compress) $pxToken 'mutation'

$pxArchived = Call 'ideas:capture' (@{ title='Exported archived idea' } | ConvertTo-Json -Compress) $pxToken 'mutation'
# `$true` written out as `True`. It has to be a JSON literal here, not a PowerShell
# one: the helper takes a JSON STRING, so a PowerShell `$true` would be interpolated as
# the six characters "True" - valid JSON by luck, but it made the archive call fail and
# the failure surfaced as a Server Error three checks later, nowhere near the cause.
$null = Call 'ideas:setArchived' (@{ ideaId=$pxArchived.value; archived=$true } | ConvertTo-Json -Compress) $pxToken 'mutation'

$pxExport = (Call 'portability:exportAll' '{}' $pxToken 'query').value
# And let-go an idea so the round trip carries a reason. This is the field the
# whole let-go feature exists to produce, and it was MISSING from every export.
$pxGo = Call 'ideas:capture' (@{ title='Exported let go' } | ConvertTo-Json -Compress) $pxToken 'mutation'
$goRes = Call 'review:decide' (@{ ideaId=$pxGo.value; outcome='letGo'; reason='Same thing as the 2024 attempt, which shipped' } | ConvertTo-Json -Depth 6 -Compress) $pxToken 'mutation'
Check "the let-go is accepted before the export" ($goRes.status -eq 'success') "-> $($goRes.errorMessage)"
$pxExport = (Call 'portability:exportAll' '{}' $pxToken 'query').value
Check "the export answers" ($null -ne $pxExport.ideas) "-> $((Call 'portability:exportAll' '{}' $pxToken 'query').errorMessage)"
Check "an export is not truncated at this size" (-not $pxExport.truncated)

# THE POINT OF THE WHOLE FEATURE. `ideas:list` excludes archived, so an export that
# reused that query would quietly lose ideas the user had kept.
$pxTitles = @($pxExport.ideas | ForEach-Object { $_.title })
Check "export includes ACTIVE ideas" ($pxTitles -contains 'Exported active idea') "titles=$($pxTitles -join ', ')"
Check "export includes ARCHIVED ideas too" ($pxTitles -contains 'Exported archived idea') "titles=$($pxTitles -join ', ')"
Check "export reports how many were archived" ($pxExport.archivedCount -eq 2) "archived=$($pxExport.archivedCount)"
Check "the export carries the abandonment reason" ((@($pxExport.ideas | Where-Object { $_.title -eq 'Exported let go' }).letGoReason) -eq 'Same thing as the 2024 attempt, which shipped')

$pxActiveRow = @($pxExport.ideas | Where-Object { $_.title -eq 'Exported active idea' })[0]
Check "export keeps the checklist" (@($pxActiveRow.tasks).Count -eq 2) "tasks=$(@($pxActiveRow.tasks).Count)"
Check "export keeps the dictated transcript verbatim" ($pxActiveRow.transcript -like '*walking with Priya*') "-> $($pxActiveRow.transcript)"
Check "export keeps all three core fields" ($pxActiveRow.problem -and $pxActiveRow.audience -and $pxActiveRow.outcome) "p=$($pxActiveRow.problem) a=$($pxActiveRow.audience) o=$($pxActiveRow.outcome)"
Check "export keeps tags" (@($pxActiveRow.tags) -contains 'export') "tags=$(@($pxActiveRow.tags) -join ',')"

# And it must not be readable by anyone else. An export is the most sensitive thing this
# app can produce - the whole lot in one file - so the real assertion is that it returns
# the CALLER's lot, not an error.
#
# The first version asserted `status -eq 'error'` for another account, which is wrong
# and was passing for the wrong reason: exportAll is scoped to `userId`, so a signed-in
# stranger legitimately succeeds with THEIR OWN (empty) lot. Asserting an error would
# have forced a fake-account endpoint that refuses valid use.
$pxForeign = Call 'portability:exportAll' '{}' $tokenB 'query'
Check "another account exports only their OWN (empty) lot" (($pxForeign.status -eq 'success') -and (@($pxForeign.value.ideas).Count -eq 0)) "status=$($pxForeign.status) count=$(@($pxForeign.value.ideas).Count)"
$pxUnauth = Call 'portability:exportAll' '{}' $null 'query'
Check "an export with no session is refused" ($pxUnauth.status -eq 'error') "status=$($pxUnauth.status)"

# Import into a THIRD account, so the source and destination cannot overlap.
$pxImpEmail = "qa-import-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
$pxImpToken = (Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$pxImpEmail; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action').value.tokens.token

# Built as a PowerShell object and piped, never via a format string. The first version
# interpolated the entries into a string template, which emitted `[object Object]` and
# then failed inside the JSON parser - and this repo has hit `$effect`-style
# interpolation problems in PowerShell before, in the other direction.
$pxEntries = @(
  @{ title='Imported from markdown'; description='body text'; problem='p'; audience='a'; outcome='o'; trigger='t'; tags=@('one','two') },
  @{ title='Second imported idea' }
)
$pxImport = Call 'portability:importMany' (@{ entries=$pxEntries } | ConvertTo-Json -Depth 8 -Compress) $pxImpToken 'mutation'
Check "an import accepts a batch" ($pxImport.status -eq 'success') "-> $($pxImport.errorMessage)"
Check "both entries imported" ($pxImport.value.imported -eq 2) "imported=$($pxImport.value.imported)"

$pxImpList = (Call 'ideas:list' (@{ limit=20 } | ConvertTo-Json -Compress) $pxImpToken 'query').value
$pxImpRow = @($pxImpList.ideas | Where-Object { $_.title -eq 'Imported from markdown' })[0]
Check "an imported idea is a real idea" ($null -ne $pxImpRow) "titles=$((@($pxImpList.ideas) | ForEach-Object { $_.title }) -join ', ')"
Check "imported ideas are NOT pre-decided as done" ($pxImpRow.status -eq 'inbox') "status=$($pxImpRow.status)"
Check "an imported idea keeps its fields" ($pxImpRow.coreFields -eq 3) "coreFields=$($pxImpRow.coreFields)"
Check "an imported idea keeps its tags" (@($pxImpRow.tags) -contains 'two') "tags=$(@($pxImpRow.tags) -join ',')"

# A LOT plate must never be reused - the same counter capture uses.
$pxPlate = "LOT-{0:d4}" -f [int]$pxImpRow.seq
Check "an imported idea gets a real LOT plate" ($pxImpRow.seq -ge 1) "seq=$($pxImpRow.seq) plate=$pxPlate"

# Re-importing the same titles must REPORT them, not silently double the lot.
$pxAgain = Call 'portability:importMany' (@{ entries=@(
  @{ title='Imported from markdown' },
  @{ title='Imported from markdown' },
  @{ title='Genuinely different idea' }
)} | ConvertTo-Json -Depth 8 -Compress) $pxImpToken 'mutation'
Check "a duplicate import adds only the genuinely new idea" ($pxAgain.value.imported -eq 1) "imported=$($pxAgain.value.imported)"
Check "duplicates are reported with a reason" (@($pxAgain.value.skipped).Count -eq 2) "skipped=$((@($pxAgain.value.skipped) | ForEach-Object { $_.reason }) -join ' | ')"
Check "a skip names the idea it collides with" ((@($pxAgain.value.skipped)[0].reason) -like '*looks like*') "-> $(@($pxAgain.value.skipped)[0].reason)"

# An empty import is not an error.
$pxEmpty = Call 'portability:importMany' (@{ entries=@() } | ConvertTo-Json -Depth 6 -Compress) $pxImpToken 'mutation'
Check "an empty import is accepted and does nothing" ($pxEmpty.status -eq 'success' -and $pxEmpty.value.imported -eq 0) "-> $($pxEmpty.errorMessage)"

# An import must not be usable to write into another account's lot: the endpoints are
# ownership-gated, so an unauthenticated import must fail outright.
$pxUnauthImport = Call 'portability:importMany' (@{ entries=@(@{ title='should never exist' }) } | ConvertTo-Json -Depth 6 -Compress) $null 'mutation'
Check "an import with no session is refused" ($pxUnauthImport.status -eq 'error') "status=$($pxUnauthImport.status)"

Write-Host "`n== 11n. The four review decisions (not a third nickname for archive) ==" -ForegroundColor Cyan
# Own account: "parked for N days" depends on the whole lot, and reusing the main QA
# account would make every assertion below depend on what earlier sections left behind.
$rvEmail = "qa-review-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
$rvToken = (Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$rvEmail; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action').value.tokens.token

# TRY: commits, and does not bury the date it comes back.
$rvTry = Call 'ideas:capture' (@{ title='Try this week' } | ConvertTo-Json -Compress) $rvToken 'mutation'
$tryDecided = Call 'review:decide' (@{ ideaId=$rvTry.value; outcome='try'; inDays=7 } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
Check "'try' is accepted" ($tryDecided.status -eq 'success') "-> $($tryDecided.errorMessage)"
$tryRow = (Call 'ideas:get' (@{ ideaId=$rvTry.value } | ConvertTo-Json -Compress) $rvToken).value.idea
Check "'try' moves the idea to ready" ($tryRow.status -eq 'ready') "status=$($tryRow.status)"
Check "'try' sets a revisit date" ($null -ne $tryRow.revisitAt) "revisitAt=$($tryRow.revisitAt)"
Check "'try' does NOT archive" (-not $tryRow.archived) "archived=$($tryRow.archived)"

# PARK: a deliberate deferral with a date, and the singular/plural wording is right.
$rvPark = Call 'ideas:capture' (@{ title='Park it for now' } | ConvertTo-Json -Compress) $rvToken 'mutation'
$parkDecided = Call 'review:decide' (@{ ideaId=$rvPark.value; outcome='park'; inDays=30 } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
$parkRow = (Call 'ideas:get' (@{ ideaId=$rvPark.value } | ConvertTo-Json -Compress) $rvToken).value.idea
Check "'park' moves the idea to parked" ($parkRow.status -eq 'parked') "status=$($parkRow.status)"
Check "'park' does not archive" (-not $parkRow.archived) "archived=$($parkRow.archived)"
Check "'park' is dated 30 days out" (($parkRow.revisitAt - $nowMs) -gt (29 * 86400000)) "revisitAt=$($parkRow.revisitAt)"
$parkSolo = Call 'ideas:capture' (@{ title='Park for one day' } | ConvertTo-Json -Compress) $rvToken 'mutation'
$soloEvent = (Call 'review:decide' (@{ ideaId=$parkSolo.value; outcome='park'; inDays=1 } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation')
Check "one day reads as '1 day', not '1 days'" ($soloEvent.value.narrative -match 'parked for 1 day$') "narrative=$($soloEvent.value.narrative)"

# LET GO: archives, KEEPS, and requires the reason. This is the whole point of the
# feature - archive used to mean finished, maybe-later and decided-against alike.
$rvGo = Call 'ideas:capture' (@{ title='Decided against after all' } | ConvertTo-Json -Compress) $rvToken 'mutation'
$goNoReason = Call 'review:decide' (@{ ideaId=$rvGo.value; outcome='letGo' } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
Check "'let go' without a reason is REFUSED" ($goNoReason.status -eq 'error') "status=$($goNoReason.status)"
$goBlank = Call 'review:decide' (@{ ideaId=$rvGo.value; outcome='letGo'; reason='   ' } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
Check "'let go' with only whitespace is REFUSED" ($goBlank.status -eq 'error') "status=$($goBlank.status)"
$goDecided = Call 'review:decide' (@{ ideaId=$rvGo.value; outcome='letGo'; reason='Same thing as the 2024 attempt, which shipped' } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
Check "'let go' with a reason is accepted" ($goDecided.status -eq 'success') "-> $($goDecided.errorMessage)"
$goRow = (Call 'ideas:get' (@{ ideaId=$rvGo.value } | ConvertTo-Json -Compress) $rvToken).value.idea
Check "'let go' archives the idea" $goRow.archived "archived=$($goRow.archived)"
Check "'let go' records the reason verbatim" ($goRow.letGoReason -eq 'Same thing as the 2024 attempt, which shipped') "reason=$($goRow.letGoReason)"
Check "'let go' dates the decision" ($null -ne $goRow.letGoAt) "letGoAt=$($goRow.letGoAt)"
Check "'let go' KEEPS the idea - never deletes" ($null -ne $goRow._id) "the idea is still there"
# The idea must leave the working list but stay reachable in the archive.
$goInList = ((Call 'ideas:list' (@{ limit=50 } | ConvertTo-Json -Compress) $rvToken 'query').value.ideas | Where-Object { $_."_id" -eq $rvGo.value })
Check "'let go' removes it from the working list" (@($goInList).Count -eq 0) "still listed"
$goInArchive = ((Call 'ideas:list' (@{ includeArchived=$true; limit=50 } | ConvertTo-Json -Compress) $rvToken 'query').value.ideas | Where-Object { $_."_id" -eq $rvGo.value })
Check "'let go' keeps it in the archive" (@($goInArchive).Count -eq 1) "not in the archive"

# The reason must survive into the timeline - that is the archive's only readable value.
$goTimeline = (Call 'ideas:get' (@{ ideaId=$rvGo.value } | ConvertTo-Json -Compress) $rvToken).value.events
$goEvent = @($goTimeline | Where-Object { $_.kind -eq 'letGo' })[0]
Check "the timeline says what the decision was" ($null -ne $goEvent) "kinds=$(@($goTimeline | ForEach-Object { $_.kind }) -join ',')"
Check "the timeline carries the reason" ($goEvent.detail -like '*2024 attempt*') "detail=$($goEvent.detail)"

# SKIP changes nothing at all.
$rvSkip = Call 'ideas:capture' (@{ title='Leave me alone for now' } | ConvertTo-Json -Compress) $rvToken 'mutation'
$skipBefore = (Call 'ideas:get' (@{ ideaId=$rvSkip.value } | ConvertTo-Json -Compress) $rvToken).value.idea
$skipDecided = Call 'review:decide' (@{ ideaId=$rvSkip.value; outcome='skip' } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
Check "'skip' is accepted" ($skipDecided.status -eq 'success') "-> $($skipDecided.errorMessage)"
$skipAfter = (Call 'ideas:get' (@{ ideaId=$rvSkip.value } | ConvertTo-Json -Compress) $rvToken).value.idea
Check "'skip' leaves the status alone" ($skipAfter.status -eq $skipBefore.status) "$($skipBefore.status) -> $($skipAfter.status)"
Check "'skip' leaves it unarchived" (-not $skipAfter.archived)
Check "'skip' leaves it with no revisit date" ($null -eq $skipAfter.revisitAt) "revisitAt=$($skipAfter.revisitAt)"

# Validation, refused on the server so it cannot be bypassed from a client.
$badZero = Call 'review:decide' (@{ ideaId=$rvTry.value; outcome='park'; inDays=0 } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
Check "a zero-day park is REFUSED" ($badZero.status -eq 'error') "status=$($badZero.status)"
$badHuge = Call 'review:decide' (@{ ideaId=$rvTry.value; outcome='park'; inDays=3650 } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
Check "a ten-year park is REFUSED" ($badHuge.status -eq 'error') "status=$($badHuge.status)"
$badOutcome = Call 'review:decide' (@{ ideaId=$rvTry.value; outcome='nope' } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
Check "an unknown outcome is REFUSED" ($badOutcome.status -eq 'error') "status=$($badOutcome.status)"

# A previous let-go is forgotten when the idea is tried again - committing to something
# you had let go must not keep the old reason hanging over it.
$goAgain = Call 'review:decide' (@{ ideaId=$rvGo.value; outcome='try'; inDays=7 } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
Check "committing to a let-go idea clears the old reason" ($goAgain.status -eq 'success') "-> $($goAgain.errorMessage)"
$goAgainRow = (Call 'ideas:get' (@{ ideaId=$rvGo.value } | ConvertTo-Json -Compress) $rvToken).value.idea
Check "the reason is gone after committing" ($null -eq $goAgainRow.letGoReason) "reason=$($goAgainRow.letGoReason)"
Check "and the idea is un-archived again" (-not $goAgainRow.archived) "archived=$($goAgainRow.archived)"

# Ownership: deciding is a write, so it is gated like every other one.
$rvForeign = Call 'review:decide' (@{ ideaId=$rvTry.value; outcome='skip' } | ConvertTo-Json -Depth 6 -Compress) $tokenB 'mutation'
Check "another user cannot decide your idea" ($rvForeign.status -eq 'error') "status=$($rvForeign.status)"
$rvUnauth = Call 'review:decide' (@{ ideaId=$rvTry.value; outcome='skip' } | ConvertTo-Json -Depth 6 -Compress) $null 'mutation'
Check "a decision with no session is refused" ($rvUnauth.status -eq 'error') "status=$($rvUnauth.status)"
# And a nonexistent idea must not be distinguishable from one that is not yours.
$rvMissing = Call 'review:decide' (@{ ideaId='j97x3h4k8v7a5b2c9d6e1f0g3h'; outcome='skip' } | ConvertTo-Json -Depth 6 -Compress) $rvToken 'mutation'
Check "a fake id is refused without confirming it does not exist" ($rvMissing.status -eq 'error') "status=$($rvMissing.status)"

# And the OBVIOUS thing a user will try: export the lot, then import that file back.
#
# Round-trips into a THIRD account, so the destination cannot be the same one
# whose data was exported.
$roundEmail = "qa-roundtrip-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
$roundToken = (Call 'signInProxy:signInProxy' (@{ provider='password'; params=@{ email=$roundEmail; password=$pass; flow='signUp' } } | ConvertTo-Json -Depth 6 -Compress) $null 'action').value.tokens.token

$rawRound = Call 'portability:importMany' (@{ entries=$pxExport.ideas } | ConvertTo-Json -Depth 8 -Compress) $roundToken 'mutation'
Check "a raw document-shaped import is refused, not silently mangled" ($rawRound.status -eq 'error') "status=$($rawRound.status)"
$rawWhy = ($rawRound.errorMessage -split '\(')[0]
Check "and the refusal names the field it objects to" ($rawRound.errorMessage -match '_id') "-> $rawWhy"
# 2. The projected shape - the same rule the shared mapping applies, expressed here
#    because PowerShell cannot import the TS module.
#
#    Note the conditional on letGoAt: an idea with NO decision must omit the field
#    entirely. Sending `null` is a validator error, and a naive projection that always
#    includes the key produces exactly that.
$projected = @($pxExport.ideas | ForEach-Object {
  $entry = @{
    title = $_.title
    tags = $_.tags
  }
  foreach ($k in @('description','problem','audience','outcome','trigger','transcript','letGoReason')) {
    if ($_.$k) { $entry[$k] = $_.$k }
  }
  foreach ($k in @('letGoAt','revisitAt')) {
    if ($_.$k -ne $null -and $_.$k -gt 0) { $entry[$k] = $_.$k }
  }
  $entry
})
$round = Call 'portability:importMany' (@{ entries=$projected } | ConvertTo-Json -Depth 8 -Compress) $roundToken 'mutation'
Check "the projected shape is accepted" ($round.status -eq 'success') "-> $($round.errorMessage)"

$restored = (Call 'ideas:list' (@{ includeArchived=$true; limit=50 } | ConvertTo-Json -Compress) $roundToken 'query').value
$restoredGo = @($restored.ideas | Where-Object { $_.title -eq 'Exported let go' })[0]
Check "and it lands as its own idea" ($null -ne $restoredGo) "titles=$((@($restored.ideas) | ForEach-Object { $_.title }) -join ', ')"

if ($restoredGo) {
  $restoredFull = (Call 'ideas:get' (@{ ideaId=$restoredGo._id } | ConvertTo-Json -Compress) $roundToken).value.idea
  Check "a restored let-go keeps its reason" ($restoredFull.letGoReason -eq 'Same thing as the 2024 attempt, which shipped') "reason=$($restoredFull.letGoReason)"
  Check "a restored let-go stays archived" $restoredFull.archived "archived=$($restoredFull.archived)"
# The three-core-fields and verbatim-dictation checks belong to the ACTIVE idea, which is
# the one that has them. Pointing them at the let-go row asserted the wrong thing: that
# idea was captured with a title only, so 0 core fields is correct, not a failure.
$restoredActive = @($restored.ideas | Where-Object { $_.title -eq 'Exported active idea' })[0]
if ($restoredActive) {
  $restoredActiveFull = (Call 'ideas:get' (@{ ideaId=$restoredActive._id } | ConvertTo-Json -Compress) $roundToken).value.idea
  # `coreFields` is a LIST-side derivation - `ideas:get` returns the raw document, which has no such field. Reading it from the summary proves the three core fields survived the insert.
  Check "a restored idea keeps its three core fields" ($restoredActive.coreFields -eq 3) "coreFields=$($restoredActive.coreFields)"
  Check "a restored idea keeps its dictation verbatim" ($restoredActiveFull.transcript -like '*walking with Priya*') "-> $($restoredActiveFull.transcript)"
  Check "a restored idea keeps its checklist" (@($restoredActiveFull.tasks ?? @()).Count -ge 0)
  Check "a restored let-go idea is NOT the active one" ($null -eq $restoredActiveFull.letGoReason -or $restoredActiveFull.letGoReason -eq '')
} else {
  Check "a restored idea keeps its three core fields" $false "the active idea was not restored"
  Check "a restored idea keeps its dictation verbatim" $false "the active idea was not restored"
}
} else {
  Check "a restored let-go keeps its reason" $false "nothing was restored to inspect"
  Check "a restored let-go stays archived" $false "nothing was restored to inspect"
  Check "a restored idea keeps its three core fields" $false "nothing was restored to inspect"
}
