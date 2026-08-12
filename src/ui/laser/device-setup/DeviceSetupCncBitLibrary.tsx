import {
  activeCncTool,
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncMachineConfig,
  type CncTool,
} from '../../../core/scene';
import { CncToolManager } from '../../machine/CncLibraryPanels';

export function DeviceSetupCncBitLibrary(props: {
  readonly machine: CncMachineConfig;
  readonly customTools: ReadonlyArray<CncTool>;
  readonly onChange: (machine: CncMachineConfig) => void;
  readonly onChangeCustomTools: (tools: ReadonlyArray<CncTool>) => void;
  readonly onRemoveTool: (toolId: string) => void;
}): JSX.Element {
  const addTool = (tool: Omit<CncTool, 'id'>): void => {
    const addition = draftToolAddition(props.machine, tool);
    if (!libraryHasTool(props.customTools, addition.tool)) {
      props.onChangeCustomTools([...props.customTools, addition.tool]);
    }
    props.onChange(addition.machine);
  };
  const deleteTool = (toolId: string): void => {
    props.onChangeCustomTools(props.customTools.filter((tool) => tool.id !== toolId));
    props.onChange(machineWithoutTool(props.machine, toolId));
    props.onRemoveTool(toolId);
  };
  const changeFluteCount = (toolId: string, fluteCount: number): void => {
    const nextMachine = {
      ...props.machine,
      tools: props.machine.tools.map((tool) =>
        tool.id === toolId ? { ...tool, fluteCount } : tool,
      ),
    };
    const nextCustomTools = props.customTools.map((tool) =>
      tool.id === toolId ? { ...tool, fluteCount } : tool,
    );
    props.onChangeCustomTools(nextCustomTools);
    props.onChange(nextMachine);
  };
  return (
    <>
      <CncToolManager
        machine={props.machine}
        customTools={props.customTools}
        onAddTool={addTool}
        onDeleteTool={deleteTool}
        onChangeFluteCount={changeFluteCount}
      />
      <p style={hintStyle}>
        Library, default-bit, and Tool Plan changes stay in this draft until final Save.
      </p>
    </>
  );
}

function draftToolAddition(
  machine: CncMachineConfig,
  input: Omit<CncTool, 'id'>,
): { readonly machine: CncMachineConfig; readonly tool: CncTool } {
  const match =
    input.catalogId === undefined
      ? undefined
      : machine.tools.find((tool) => tool.catalogId === input.catalogId);
  const tool: CncTool = { ...input, id: match?.id ?? crypto.randomUUID() };
  const tools =
    match === undefined
      ? [...machine.tools, tool]
      : machine.tools.map((candidate) => (candidate.id === match.id ? tool : candidate));
  return { machine: { ...machine, tools }, tool };
}

function machineWithoutTool(machine: CncMachineConfig, toolId: string): CncMachineConfig {
  const remaining = machine.tools.filter((tool) => tool.id !== toolId);
  const tools = remaining.length === 0 ? DEFAULT_CNC_MACHINE_CONFIG.tools : remaining;
  const next: CncMachineConfig = { ...machine, tools };
  return { ...next, toolId: activeCncTool(next).id };
}

function libraryHasTool(tools: ReadonlyArray<CncTool>, candidate: CncTool): boolean {
  return tools.some(
    (tool) =>
      tool.id === candidate.id ||
      (candidate.catalogId !== undefined && tool.catalogId === candidate.catalogId),
  );
}

const hintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 11,
  lineHeight: 1.35,
};
