import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const ios = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(ios, '../..');
const source = readdirSync(path.join(ios, 'Sources')).filter(x => x.endsWith('.swift'))
  .map(x => readFileSync(path.join(ios, 'Sources', x), 'utf8')).join('\n');
const functions = [...new Set([...source.matchAll(/"((?:ideas|tasks|review|auth):\w+)"/g)].map(x => x[1]))];
for (const fn of functions) {
  const [module, name] = fn.split(':');
  const backend = readFileSync(path.join(root, 'src/convex', `${module}.ts`), 'utf8');
  if (module === 'auth') assert.match(backend, new RegExp(`\\b${name}\\b`));
  else assert.match(backend, new RegExp(`export const ${name} = (query|mutation)`));
}
assert.deepEqual([...functions].sort(), [
  'auth:signIn', 'auth:signOut', 'ideas:capture', 'ideas:get', 'ideas:list',
  'ideas:remove', 'ideas:setArchived', 'ideas:setStatus', 'ideas:toggleFavorite',
  'ideas:update', 'review:queue', 'review:snooze', 'tasks:addTask',
  'tasks:removeTask', 'tasks:toggleTask', 'tasks:updateTask'
].sort());
assert.match(source, /Double\(days\)/);
assert.match(source, /yielding: IdeaDetail\?\.self/);
assert.match(source, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
assert.match(source, /args\.updateValue\(scored \? value : nil, forKey: key\)/);
assert.match(source, /revisitAt: hasRevisit \? .*rounded\(\) : nil/);
assert.match(source, /@State private var baseline: Idea/);
assert.match(source, /if description != \(baseline\.description \?\? ""\)/);
assert.match(source, /"ideas:capture", \["title": submitted, "source": "typed"\]\), title == submitted/);
assert.match(source, /"tasks:addTask", \["ideaId": ideaId, "title": submitted\]\), taskTitle == submitted/);
for (const arg of ['archivedOnly', 'favoriteOnly', 'sortPriority']) {
  assert.match(source, new RegExp(`"${arg}":`));
  assert.match(readFileSync(path.join(root, 'src/convex/ideas.ts'), 'utf8'), new RegExp(`${arg}: v.optional\\(v.boolean\\(\\)\\)`));
}
assert.match(readFileSync(path.join(ios, 'project.yml'), 'utf8'), /exactVersion: 0\.8\.1/);
console.log(`Verified ${functions.length} existing Convex function contracts; Swift compilation remains Mac-only.`);
