# Drives the one-off QA-data scrub.
#
# Convex allows only ONE paginated query per function execution, so each step
# here advances exactly one page and calls again. Deliberately paced with a small
# sleep: the deployment is over its Free-plan quota and being told to decrease
# usage, so the loop must not add meaningful load of its own.
$ErrorActionPreference = 'Stop'

function Run($path, $jsonArgs = '{}') {
    $out = npx convex run $path $jsonArgs 2>&1 | Out-String
    if ($out -match 'Uncaught|Failed to run') { throw "call $path failed: $out" }
    return ($out -replace '(?s)^.*?(\{.*\})\s*$', '$1') | ConvertFrom-Json
}

# 1. Mark doomed users, one page at a time.
$cursor = $null
$total = 0
$guard = 0
do {
    $args = if ($cursor) { "{`"cursor`":`"$cursor`"}" } else { '{}' }
    $r = Run 'maintenance:markDoomedUsers' $args
    $total = $total + $r.markedThisCall
    $cursor = $r.cursor
    $guard = $guard + 1
    Start-Sleep -Milliseconds 250
} while (-not $r.isDone -and $guard -lt 200)
Write-Host "marked $total doomed users" -ForegroundColor Green

# 2. Wipe dependent tables.
$tables = @(
    'ideas',
    'ideaEvents',
    'ideaTasks',
    'counters',
    'authSessions',
    'authRefreshTokens',
    'authAccounts'
)

$grand = 0
foreach ($t in $tables) {
    $byEmail = if ($t -eq 'authAccounts') { 'true' } else { 'false' }
    $cursor = $null
    $deleted = 0
    $guard = 0
    do {
        $parts = '"table":"' + $t + '","byEmail":' + $byEmail
        if ($cursor) { $parts = $parts + ',"cursor":"' + $cursor + '"' }
        $r = Run 'maintenance:wipePage' ('{' + $parts + '}')
        $deleted = $deleted + $r.deletedThisCall
        $cursor = $r.cursor
        $guard = $guard + 1
        Start-Sleep -Milliseconds 250
    } while (-not $r.isDone -and $guard -lt 400)
    Write-Host ("  {0,-20} deleted {1}" -f $t, $deleted)
    $grand = $grand + $deleted
}

# 3. The users themselves (matched by their own email column).
$deleted = 0
$guard = 0
do {
    $r = Run 'maintenance:wipePage' '{"table":"users","byEmail":true}'
    $deleted = $deleted + $r.deletedThisCall
    $guard = $guard + 1
    Start-Sleep -Milliseconds 250
} while (-not $r.isDone -and $guard -lt 200)
Write-Host ("  {0,-20} deleted {1}" -f 'users', $deleted)

Run 'maintenance:clearScratch' '{"confirm":true}' | Out-Null

$all = $grand + $deleted
Write-Host ''
Write-Host "TOTAL DELETED: $all" -ForegroundColor Green