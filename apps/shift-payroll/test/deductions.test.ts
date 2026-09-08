import { describe, expect, it } from 'vitest';

import {
  computeDeductions,
  computeIncomeTaxKou,
  computeIncomeTaxOtsu,
  healthStandardRemuneration,
  pensionStandardRemuneration,
  roundInsurance,
  roundTax,
} from '../lib/payroll/deductions';
import { INCOME_TAX_R2_TO_R7, INCOME_TAX_R8, incomeTaxTableFor } from '../lib/payroll/tax-tables';
import { DEFAULT_SETTINGS } from '../lib/settings';

describe('端数処理', () => {
  it('被保険者負担分は 50 銭以下切り捨て・50 銭超切り上げ', () => {
    expect(roundInsurance(7432.5)).toBe(7432);
    expect(roundInsurance(7432.51)).toBe(7433);
    expect(roundInsurance(7432.49)).toBe(7432);
    expect(roundInsurance(100)).toBe(100);
  });

  it('所得税は 10 円未満を四捨五入', () => {
    expect(roundTax(4764.65)).toBe(4760);
    expect(roundTax(4765)).toBe(4770);
    expect(roundTax(0)).toBe(0);
  });
});

describe('標準報酬月額の等級', () => {
  it('健康保険: 報酬月額の帯 → 標準報酬月額', () => {
    expect(healthStandardRemuneration(50_000)).toBe(58_000);
    expect(healthStandardRemuneration(92_999)).toBe(88_000);
    expect(healthStandardRemuneration(93_000)).toBe(98_000);
    expect(healthStandardRemuneration(150_000)).toBe(150_000);
    expect(healthStandardRemuneration(154_999)).toBe(150_000);
    expect(healthStandardRemuneration(155_000)).toBe(160_000);
    expect(healthStandardRemuneration(280_000)).toBe(280_000);
    expect(healthStandardRemuneration(2_000_000)).toBe(1_390_000);
  });

  it('厚生年金: 88,000〜650,000 に丸める', () => {
    expect(pensionStandardRemuneration(50_000)).toBe(88_000);
    expect(pensionStandardRemuneration(280_000)).toBe(280_000);
    expect(pensionStandardRemuneration(2_000_000)).toBe(650_000);
  });
});

describe('源泉所得税(甲欄・電算機計算の特例)', () => {
  it('令和7年分: A=200,000・扶養 0 → 4,760 円', () => {
    // 給与所得控除 200,000×30%+6,667=66,667 / 基礎控除 40,000 → B=93,333 → ×5.105%=4,764.65 → 4,760
    expect(computeIncomeTaxKou(200_000, 0, INCOME_TAX_R2_TO_R7)).toBe(4_760);
  });

  it('令和7年分: 扶養 2 人で 31,667×2 が控除される → 1,530 円', () => {
    // B = 93,333 − 63,334 = 29,999 → 1,531.4 → 1,530
    expect(computeIncomeTaxKou(200_000, 2, INCOME_TAX_R2_TO_R7)).toBe(1_530);
  });

  it('令和7年分: A=400,000 は 10.21% の帯 → 16,550 円', () => {
    // 給与所得控除 400,000×20%+36,667=116,667 → B=243,333 → 24,844.3−8,296=16,548.3 → 16,550
    expect(computeIncomeTaxKou(400_000, 0, INCOME_TAX_R2_TO_R7)).toBe(16_550);
  });

  it('課税所得が 0 以下なら税額 0', () => {
    expect(computeIncomeTaxKou(80_000, 0, INCOME_TAX_R2_TO_R7)).toBe(0);
    expect(computeIncomeTaxKou(0, 0, INCOME_TAX_R8)).toBe(0);
  });

  it('令和8年分: 基礎控除の拡大で A=130,000 は 0 円、A=200,000 は 3,060 円', () => {
    expect(computeIncomeTaxKou(130_000, 0, INCOME_TAX_R8)).toBe(0);
    // 給与所得控除 66,667 / 基礎控除 73,334 → B=59,999 → 3,062.9 → 3,060
    expect(computeIncomeTaxKou(200_000, 0, INCOME_TAX_R8)).toBe(3_060);
  });

  it('年で表を切り替える(2026 年以降は令和8年分)', () => {
    expect(incomeTaxTableFor(2025)).toBe(INCOME_TAX_R2_TO_R7);
    expect(incomeTaxTableFor(2026)).toBe(INCOME_TAX_R8);
  });
});

describe('源泉所得税(乙欄)', () => {
  it('88,000 円未満は 3.063%(円未満切り捨て)', () => {
    expect(computeIncomeTaxOtsu(50_000)).toBe(1_531);
    expect(computeIncomeTaxOtsu(87_999)).toBe(2_695);
  });

  it('88,000 円以上は自動計算しない(null)', () => {
    expect(computeIncomeTaxOtsu(88_000)).toBeNull();
  });
});

describe('computeDeductions(統合)', () => {
  const settings = DEFAULT_SETTINGS;

  it('社員(社保・雇用保険加入、標準報酬 280,000)の控除', () => {
    const r = computeDeductions({
      grossPay: 280_000,
      staff: { socialInsuranceEnrolled: true, employmentInsuranceEnrolled: true, standardMonthlyRemuneration: 280_000, dependentsCount: 0, taxTableType: 'KOU' },
      settings,
      year: 2026,
    });
    expect(r.healthInsurance).toBe(13_874); // 280,000×9.91%÷2
    expect(r.careInsurance).toBe(0);
    expect(r.pensionInsurance).toBe(25_620); // 280,000×18.3%÷2
    expect(r.employmentInsurance).toBe(1_540); // 280,000×0.55%
    expect(r.socialInsuranceTotal).toBe(41_034);
    expect(r.taxableIncome).toBe(238_966);
    // 給与所得控除 floor(238,966×0.3+6,667)=78,356 / 基礎控除 73,334 → B=87,276 → 4,455.4 → 4,460
    expect(r.incomeTax).toBe(4_460);
    expect(r.totalDeductions).toBe(45_494);
    expect(r.warnings).toEqual([]);
  });

  it('介護保険対象(40〜64 歳)は介護保険料が加わる', () => {
    const r = computeDeductions({
      grossPay: 280_000,
      staff: { socialInsuranceEnrolled: true, careInsuranceApplicable: true, standardMonthlyRemuneration: 280_000 },
      settings,
      year: 2026,
    });
    expect(r.careInsurance).toBe(2_226); // 280,000×1.59%÷2
  });

  it('標準報酬月額が未設定なら当月総支給から推定し警告する(五捨六入も確認)', () => {
    const r = computeDeductions({ grossPay: 150_000, staff: { socialInsuranceEnrolled: true }, settings, year: 2026 });
    expect(r.standardMonthlyRemuneration).toBe(150_000);
    expect(r.healthInsurance).toBe(7_432); // 7,432.5 → 切り捨て
    expect(r.warnings.join()).toContain('標準報酬月額が未設定');
  });

  it('未加入のアルバイト(甲欄)は社保・雇用保険 0、少額なら所得税も 0', () => {
    const r = computeDeductions({ grossPay: 100_000, staff: {}, settings, year: 2026 });
    expect(r.socialInsuranceTotal).toBe(0);
    expect(r.incomeTax).toBe(0);
    expect(r.totalDeductions).toBe(0);
    expect(r.standardMonthlyRemuneration).toBeNull();
  });

  it('乙欄 88,000 円以上は税額 0 + 手入力を促す警告、固定額があればそれを使う', () => {
    const noFixed = computeDeductions({ grossPay: 120_000, staff: { taxTableType: 'OTSU' }, settings, year: 2026 });
    expect(noFixed.incomeTax).toBe(0);
    expect(noFixed.warnings.join()).toContain('乙欄');

    const fixed = computeDeductions({ grossPay: 120_000, staff: { taxTableType: 'OTSU', fixedIncomeTax: 4_300 }, settings, year: 2026 });
    expect(fixed.incomeTax).toBe(4_300);
    expect(fixed.warnings.join()).toContain('固定額');
  });

  it('NONE(源泉徴収しない)は所得税 0', () => {
    const r = computeDeductions({ grossPay: 300_000, staff: { taxTableType: 'NONE' }, settings, year: 2026 });
    expect(r.incomeTax).toBe(0);
  });
});
