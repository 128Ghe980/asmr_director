# Operation results and the multi-sentence hint

Date: 2026-10-23. Route: Audio Quality V1; the parent stage remains in progress and SFX stays paused.

Batch generation, storyboard review and audio processing results share a single-line summary in the script column. **View results** opens a separate native modal. It does not open automatically or insert full results above the script list. Active progress and cancellation remain in their original toolbar.

The modal retains complete failed-shot identifiers, dialogue and errors, review differences and notes, apply/undo actions, and individual or combined processed-audio playback/download. Visual ellipsis in the summary never truncates details or changes project data. A review with no revisions is described as such, without claiming content quality approval. One content area scrolls, long text wraps, and close, Escape, backdrop dismissal and focus return are supported. Closing releases processed-preview requests and temporary playback resources without cancelling main generation. Changing project or speech workspace closes the modal.

After the user's subsequent correction, remove both the unsplit-passage and multi-sentence reminders and the punctuation-based split control entirely. Short speech means a compact delivery, meaning or action unit and may contain several sentence endings. A grammatical sentence is not its required boundary. See the [current semantic-unit definition](2026-10-23-semantic-speech-units.en.md).

Generation and adoption preserve valid model-defined units; ordinary edits, blur and workspace switching no longer repartition them at punctuation. Keep explicit selection splits, merges, source synchronization and undo. Do not migrate or guess how to merge saved projects.

Verification covers component interactions, integration flows, types, lint, the production build and served static-resource identity. User browser projects are not read or written. A JSDOM dialog shim does not establish real-browser focus containment, background inertness or visual quality.
