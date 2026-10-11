export const mcpMachineToolInfo = {
  get_machine_status: {
    title: 'Read live machine status',
    description:
      'Read factual connection, work position, motion and job state from the open desktop app. Read its current revision before requesting motion. No controller command is sent by this read; reported status is not proof of physical safety.',
  },
  get_control_operation: {
    title: 'Check a machine operation',
    description:
      'Read the outcome of your own operationId. Use the original requestId as operationId after a lost or timed-out action reply. Canonical Job Review facts are bounded pages: pagination counts describe the complete same review; fetch each nextOffset with reviewPage {reviewId, offset} to inspect all warnings, statistics and operation summaries. A changed reviewId invalidates old pages. Unknown means the outcome is unconfirmed; never automatically send another motion or job with a new ID.',
  },
  jog_machine: {
    title: 'Jog the machine',
    description:
      'Move the approved computer’s machine by one bounded relative jog using the ordinary physical jog-pad direction. Requires separate machine-control approval, current expectedRevision and UUID requestId. Z requires reported support. An accepted receipt is not completed motion. Do not retry with a new ID after an uncertain reply.',
  },
  frame_job: {
    title: 'Frame the current job',
    description:
      'Begin ordinary desktop Frame for the current workspace using the existing machine workflow. Requires separate machine-control approval, expectedRevision and UUID requestId. Poll operationId until completed; admission does not confirm a completed physical Frame. Do not automatically repeat a timed-out Frame.',
  },
  review_machine_job: {
    title: 'Prepare the current job for Start',
    description:
      'Prepare the current exact desktop program and publish its ordinary Job Review after Frame. Requires separate machine-control approval, expectedRevision and UUID requestId. Poll operationId for awaiting_review and read the review before choosing Start. This call does not confirm the review or begin cutting.',
  },
  start_job: {
    title: 'Start the reviewed job',
    description:
      'Confirm and start the exact one-use reviewId only after the user has read the canonical Job Review and its acknowledgement prompt and explicitly chosen Start. A status question is not confirmation. Requires separate machine-control approval, current expectedRevision and UUID requestId. Changed output requires a new review, never automatic confirmation. Cutting is consequential; accepted/starting is not proof that the job finished. Never retry with a new ID after an uncertain reply.',
  },
  abort_job: {
    title: 'Abort current machine work',
    description:
      'Cancel pending remote preparation and invoke the ordinary current desktop Abort. Requires separate machine-control approval and UUID requestId; no workspace revision is needed. Poll the operation and machine state afterward. This is a software Abort, not a hardware emergency stop or proof the machine is physically stopped.',
  },
  connect_machine: {
    title: 'Connect the selected machine',
    description:
      'Connect the PC to its selected machine using the connection the operator already chose on that PC. Never opens a port picker and never reports port names. Requires machine-control approval, expectedRevision and UUID requestId. Poll operationId; a refused connection means the operator must connect once on the PC.',
  },
  disconnect_machine: {
    title: 'Disconnect the machine',
    description:
      'Disconnect the PC from its machine through the ordinary desktop action. Refused while a job or motion is active. Requires machine-control approval, expectedRevision and UUID requestId.',
  },
  home_machine: {
    title: 'Home the machine',
    description:
      'Run the ordinary desktop Home cycle. The machine moves to its limit switches. Ask the user to confirm the work area is clear first. Requires machine-control approval, expectedRevision and UUID requestId. Poll operationId until completed or failed; never repeat a timed-out Home with a new ID.',
  },
  set_work_origin: {
    title: 'Set the work origin here',
    description:
      'Set the work origin at the current head position using the ordinary desktop action: axes "xy" sets X/Y, "z" zeros Z where supported. No motion. Requires machine-control approval, expectedRevision and UUID requestId.',
  },
  pause_job: {
    title: 'Pause the running job',
    description:
      'Pause the running job through the ordinary desktop pause with its controller confirmation. Requires machine-control approval and UUID requestId; no workspace revision is needed. Poll machine status for paused.',
  },
  resume_job: {
    title: 'Resume the paused job',
    description:
      'Resume the paused job through the ordinary desktop resume. Only after the user explicitly asks; the machine moves and the tool may turn on. Requires machine-control approval and UUID requestId.',
  },
  jog_hold_start: {
    title: 'Start a held jog',
    description: 'Phone only. Begin a continuous jog that the PC stops when heartbeats stop.',
  },
  jog_hold_stop: {
    title: 'Stop a held jog',
    description: 'Phone only. Stop the continuous jog started by operationId.',
  },
  get_camera_snapshot: {
    title: 'Show the machine camera',
    description:
      'Return one bounded JPEG still from the camera configured on the PC. Requires machine-control approval and the desktop artwork-sharing opt-in. Camera addresses and credentials are never returned. The picture is not a position or alignment guarantee.',
  },
} as const;
