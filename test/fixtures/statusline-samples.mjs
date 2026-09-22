/** 全期間が揃った正常な statusLine JSON */
export const fullStatusLine = {
    rate_limits: {
        five_hour: { used_percentage: 45.5, resets_at: 1720018000 },
        seven_day: { used_percentage: 23.0, resets_at: 1720500000 },
    },
};

/** five_hour のみ */
export const fiveHourOnly = {
    rate_limits: {
        five_hour: { used_percentage: 80, resets_at: 1720018000 },
    },
};

/** seven_day のみ */
export const sevenDayOnly = {
    rate_limits: {
        seven_day: { used_percentage: 10, resets_at: 1720500000 },
    },
};

/** rate_limits が存在しない */
export const noRateLimits = {};

/** rate_limits の値が null */
export const nullPeriods = {
    rate_limits: { five_hour: null, seven_day: null },
};

/** used_percentage が欠落した期間 */
export const missingUsedPercentage = {
    rate_limits: {
        five_hour: { resets_at: 1720018000 },
        seven_day: { used_percentage: 50, resets_at: 1720500000 },
    },
};

/** 100% 使用済み */
export const fullyUsed = {
    rate_limits: {
        five_hour: { used_percentage: 100, resets_at: 1720018000 },
        seven_day: { used_percentage: 100, resets_at: 1720500000 },
    },
};

/** 使用率が範囲外（クランプテスト用） */
export const outOfRange = {
    rate_limits: {
        five_hour: { used_percentage: 150, resets_at: 1720018000 },
        seven_day: { used_percentage: -10, resets_at: 1720500000 },
    },
};
