export class BiDirectionalRecord<
    const I extends string | number,
    const O extends string | number,
> {
    public readonly from: Record<I, O>;
    public readonly to: Record<O, I>;
    constructor(xs: [I, O][]) {
        const from = {} as Record<I, O>;
        const to = {} as Record<O, I>;

        for (const [i, o] of xs) {
            from[i] = o;
            to[o] = i;
        }
        this.from = from;
        this.to = to;
    }

    public static fromLiterals<I extends string | number>(
        xs: readonly I[],
    ): BiDirectionalRecord<I, number> {
        return new BiDirectionalRecord(xs.map((value, i) => [value, i]));
    }
}
