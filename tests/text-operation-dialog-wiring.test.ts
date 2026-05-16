import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(process.cwd(), ...segments), 'utf8');
}

const addTextDialog = readSource('src', 'ui', 'components', 'AddTextDialog.tsx');
const variableTextDialog = readSource('src', 'ui', 'components', 'VariableTextDialog.tsx');
const appSource = readSource('src', 'ui', 'components', 'App.tsx');
const appTextCommitHelpers = readSource('src', 'ui', 'components', 'app', 'appTextCommitHelpers.ts');
const appTextDialogOpenHelpers = readSource('src', 'ui', 'components', 'app', 'appTextDialogOpenHelpers.ts');
const generatorHandlers = readSource('src', 'ui', 'hooks', 'useGeneratorHandlers.ts');

assert(addTextDialog.includes('Engrave name'), 'AddTextDialog should offer Engrave name');
assert(addTextDialog.includes('Cut name'), 'AddTextDialog should offer Cut name');
assert(addTextDialog.includes('textOperationMode'), 'AddTextDialog props should include textOperationMode');

assert(appSource.includes('textOperationMode: dialogs.textOperationMode'), 'App should pass text operation state into AddTextDialog');
assert(appSource.includes('buildTextDialogSceneCommit'), 'App text submit should delegate scene mutation to the text commit helper');
assert(appTextCommitHelpers.includes('resolveTextOperationLayer(scene, draft.textOperationMode)'), 'Text commit helper should resolve the chosen text operation layer');
assert(appSource.includes('buildTextEditDialogRequest'), 'App edit text should delegate dialog-open policy to the helper');
assert(appTextDialogOpenHelpers.includes('textOperationModeForObject(scene, obj)'), 'Text dialog open helper should derive the existing object operation');

assert(variableTextDialog.includes('Engrave names'), 'VariableTextDialog should offer Engrave names');
assert(variableTextDialog.includes('Cut names'), 'VariableTextDialog should offer Cut names');
assert(variableTextDialog.includes('onGenerate(objects, operationMode)'), 'VariableTextDialog should submit the chosen operation mode');

assert(generatorHandlers.includes('assignObjectsToTextOperationLayer'), 'Variable text generation should assign copies to the chosen operation layer');
