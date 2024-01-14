export class DuplicateTestCase extends Error {
    public constructor(public data: unknown) {
        super(
            `A testcase with this ID already exists. Ensure test inputs are unique, otherwise you may have conflicting expectations for the same input.`,
        );
    }
}
