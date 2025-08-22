/*

LCS implementation that supports arrays or strings

reference: http://en.wikipedia.org/wiki/Longest_common_subsequence_problem

*/

import type {MatchContext} from './arrays.js';

const defaultMatch = (
    array1: readonly unknown[],
    array2: readonly unknown[],
    index1: number,
    index2: number,
) => array1[index1] === array2[index2];

const lengthMatrix = (
    array1: readonly unknown[],
    array2: readonly unknown[],
    match: (
        array1: readonly unknown[],
        array2: readonly unknown[],
        index1: number,
        index2: number,
        context: MatchContext,
    ) => boolean | undefined,
    context: MatchContext,
) => {
    const len1 = array1.length;
    const len2 = array2.length;
    let x;
    let y;

    // initialize empty matrix of len1+1 x len2+1
    const matrix: number[][] & {
        match?: (
            array1: readonly unknown[],
            array2: readonly unknown[],
            index1: number,
            index2: number,
            context: MatchContext,
        ) => boolean | undefined;
    } = new Array(len1 + 1);
    for (x = 0; x < len1 + 1; x++) {
        matrix[x] = new Array<number>(len2 + 1);
        for (y = 0; y < len2 + 1; y++) {
            matrix[x][y] = 0;
        }
    }
    matrix.match = match;
    // save sequence lengths for each coordinate
    for (x = 1; x < len1 + 1; x++) {
        for (y = 1; y < len2 + 1; y++) {
            if (match(array1, array2, x - 1, y - 1, context)) {
                matrix[x][y] = matrix[x - 1][y - 1] + 1;
            } else {
                matrix[x][y] = Math.max(matrix[x - 1][y], matrix[x][y - 1]);
            }
        }
    }
    return matrix;
};

interface Subsequence {
    sequence: unknown[];
    indices1: number[];
    indices2: number[];
}

const backtrack = (
    matrix: number[][] & {
        match?: (
            array1: readonly unknown[],
            array2: readonly unknown[],
            index1: number,
            index2: number,
            context: MatchContext,
        ) => boolean | undefined;
    },
    array1: readonly unknown[],
    array2: readonly unknown[],
    context: MatchContext,
) => {
    let index1 = array1.length;
    let index2 = array2.length;
    const subsequence: Subsequence = {
        sequence: [],
        indices1: [],
        indices2: [],
    };

    while (index1 !== 0 && index2 !== 0) {
        const sameLetter = matrix.match!(
            array1,
            array2,
            index1 - 1,
            index2 - 1,
            context,
        );
        if (sameLetter) {
            subsequence.sequence.unshift(array1[index1 - 1]);
            subsequence.indices1.unshift(index1 - 1);
            subsequence.indices2.unshift(index2 - 1);
            --index1;
            --index2;
        } else {
            const valueAtMatrixAbove = matrix[index1][index2 - 1];
            const valueAtMatrixLeft = matrix[index1 - 1][index2];
            if (valueAtMatrixAbove > valueAtMatrixLeft) {
                --index2;
            } else {
                --index1;
            }
        }
    }
    return subsequence;
};

const get = (
    array1: readonly unknown[],
    array2: readonly unknown[],
    match?: (
        array1: readonly unknown[],
        array2: readonly unknown[],
        index1: number,
        index2: number,
        context: MatchContext,
    ) => boolean | undefined,
    context?: MatchContext,
) => {
    const innerContext = context || {};
    const matrix = lengthMatrix(
        array1,
        array2,
        match || defaultMatch,
        innerContext,
    );
    return backtrack(matrix, array1, array2, innerContext);
};

export default {
    get,
};
