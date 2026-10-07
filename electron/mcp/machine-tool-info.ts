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
} as const;
