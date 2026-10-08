/** The current sheet is the ordinary Project scene/setup; only inactive sheets
 * are archived. Output can never accidentally traverse these JSON documents. */
export type ProjectSheetBook = {
  readonly activeId: string;
  readonly activeName: string;
  readonly inactive: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly projectJson: string;
  }>;
};
