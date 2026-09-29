export const RELEASE_MOTORS_CONFIRM =
  'Release motors?\n\n' +
  'This sends $SLP to put the controller to sleep so you can push the head by hand. ' +
  'The controller will ignore normal commands until you Wake it with Ctrl-X, and moving the ' +
  'head by hand invalidates the work origin. Move the head first, then use the guided ' +
  'recovery to Wake, Unlock, and Set origin. Do not release motors during a job.';
