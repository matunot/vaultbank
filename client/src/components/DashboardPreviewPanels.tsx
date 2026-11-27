import PreviewOnlyNotice from './PreviewOnlyNotice';

/**
 * Production dashboard disclosures.
 *
 * These panels are deliberately honest placeholders: the corresponding
 * analytics/goal/budget features are not connected to the live ledger yet.
 * Kept in the eager graph (they are tiny) so production never ships the
 * development sample-data widgets.
 */
export default function DashboardPreviewPanels() {
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div><PreviewOnlyNotice title="Savings goals are not connected yet" message="Example goals are shown only in local development. Goal balances are not linked to your account ledger." /></div>
        <div><PreviewOnlyNotice title="Budget tracking is a preview" message="The budget widget uses sample values in local development and is not yet connected to your verified transaction history." /></div>
        <div><PreviewOnlyNotice title="Currency conversion is an estimate only" message="The local development converter uses example rates. It does not provide a live FX quote or execute a currency exchange." /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        <div className="lg:col-span-2"><PreviewOnlyNotice title="No issued cards are linked yet" message="Only cards confirmed by the issuing provider will appear here. Example cards are limited to local development." /></div>
        <div><PreviewOnlyNotice title="Portfolio holdings are not connected" message="Sample holdings and market movements are shown only in local development. No live investments are represented here." /></div>
        <div><PreviewOnlyNotice title="Calendar is a preview" message="Sample dates and bills are shown only in local development. No real bill schedule is linked yet." /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div><PreviewOnlyNotice title="Trusted recipients will appear here" message="Example contacts are limited to local development. Use Payments to search registered recipients from the backend." /></div>
        <div><PreviewOnlyNotice title="Achievements are a preview" message="Example milestones are shown only in local development; live achievements have not been connected to verified activity." /></div>
        <div><PreviewOnlyNotice title="Personalized insights are not active yet" message="The current insights are fixed examples and are not generated from your actual transactions. They are shown only in local development." /></div>
      </div>
    </>
  );
}
