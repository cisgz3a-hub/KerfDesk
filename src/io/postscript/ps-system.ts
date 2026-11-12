// Builds an interpreter with the supported operator set (ADR-700).

import { CONTROL_OPS, DICT_OPS, ENVIRONMENT_OPS } from './ps-ops-control';
import { GSTATE_OPS } from './ps-ops-gstate';
import { PATH_OPS } from './ps-ops-path';
import { STACK_OPS, type OpTable } from './ps-ops-stack';
import { TEXT_OPS } from './ps-ops-text';
import { PsVm } from './ps-vm';
import { psDict, type PsDict } from './ps-types';

const TABLES: readonly OpTable[] = [
  STACK_OPS,
  CONTROL_OPS,
  DICT_OPS,
  ENVIRONMENT_OPS,
  GSTATE_OPS,
  PATH_OPS,
  TEXT_OPS,
];

export function createPsVm(clock?: () => number): PsVm {
  const vm = new PsVm(clock);
  installOps(vm.systemdict, ...TABLES);
  const named: Readonly<Record<string, PsDict>> = {
    systemdict: vm.systemdict,
    globaldict: vm.globaldict,
    userdict: vm.userdict,
    statusdict: psDict(),
    errordict: psDict(),
    $error: psDict(),
    FontDirectory: psDict(),
    GlobalFontDirectory: psDict(),
    SharedFontDirectory: psDict(),
  };
  for (const [name, dict] of Object.entries(named)) vm.systemdict.map.set(name, dict);
  return vm;
}

export function installOps(dict: PsDict, ...tables: readonly OpTable[]): void {
  for (const table of tables)
    for (const [name, run] of Object.entries(table))
      dict.map.set(name, { kind: 'operator', name, run });
}
