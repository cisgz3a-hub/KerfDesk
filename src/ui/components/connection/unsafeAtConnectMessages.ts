/**
 * T3-91 UI compatibility re-export.
 *
 * The implementation lives in src/app so machine-command recovery text
 * stays outside the UI tree. Existing UI imports keep working through this
 * narrow re-export.
 */
export {
  describeUnsafeAtConnect,
  type UnsafeAtConnectActionKind,
  type UnsafeAtConnectMessage,
} from '../../../app/unsafeAtConnectMessages';
