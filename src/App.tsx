import React, { useState, useMemo, useRef, useEffect } from 'react';
import { create } from 'zustand';
import { 
  Plus, 
  Trash2, 
  Calculator, 
  TrendingDown, 
  DollarSign, 
  ChevronDown, 
  ChevronUp,
  LayoutGrid,
  List,
  Copy,
  ArrowRightLeft,
  Hourglass,
  Settings2,
  Download,
  Upload,
  Save
} from 'lucide-react';
import { InputNumber, Button, Tooltip, Radio, Tag, message } from 'antd';

/**
 * ------------------------------------------------------------------
 * 1. ZUSTAND STORE & TYPES
 * ------------------------------------------------------------------
 */

const generateId = () => Math.random().toString(36).substr(2, 9);

const defaultScenario = {
  id: 'default-1',
  name: '情境 A',
  amount: 10000000, 
  rate: 2.1,        
  totalMonths: 360, 
  periodUnit: 'year', 
  graceMonths: 0, 
  repaymentStrategy: 'reduce_term',
  roundingMode: 'round', 
  isMultiRate: false,
  rateStages: [
    { id: generateId(), startMonth: 1, rate: 1.7 },
    { id: generateId(), startMonth: 25, rate: 2.1 }
  ],
  extraPayments: [] 
};

const useLoanStore = create((set) => ({
  scenarios: [defaultScenario],

  addScenario: () => set((state) => {
    const newId = generateId();
    return {
      scenarios: [
        ...state.scenarios, 
        { 
          ...defaultScenario, 
          id: newId, 
          name: `情境 ${String.fromCharCode(65 + state.scenarios.length)}` 
        }
      ]
    };
  }),

  copyScenario: (id) => set((state) => {
    const target = state.scenarios.find(s => s.id === id);
    if (!target) return {};
    return {
      scenarios: [
        ...state.scenarios,
        {
          ...target,
          id: generateId(),
          name: `${target.name} (複製)`,
          extraPayments: target.extraPayments.map(p => ({...p, id: generateId()})),
          rateStages: target.rateStages.map(r => ({...r, id: generateId()}))
        }
      ]
    };
  }),

  removeScenario: (id) => set((state) => {
    if (state.scenarios.length <= 1) return {};
    return {
      scenarios: state.scenarios.filter((s) => s.id !== id)
    };
  }),

  updateScenario: (id, field, value) => set((state) => ({
    scenarios: state.scenarios.map((s) => 
      s.id === id ? { ...s, [field]: value } : s
    )
  })),

  addExtraPayment: (scenarioId, month, amount) => set((state) => ({
    scenarios: state.scenarios.map((s) => {
      if (s.id !== scenarioId) return s;
      return {
        ...s,
        extraPayments: [...s.extraPayments, { id: generateId(), month: parseInt(month), amount: parseInt(amount) }]
          .sort((a, b) => a.month - b.month)
      };
    })
  })),

  removeExtraPayment: (scenarioId, paymentId) => set((state) => ({
    scenarios: state.scenarios.map((s) => {
      if (s.id !== scenarioId) return s;
      return {
        ...s,
        extraPayments: s.extraPayments.filter(p => p.id !== paymentId)
      };
    })
  })),

  addRateStage: (scenarioId) => set((state) => ({
    scenarios: state.scenarios.map(s => {
      if (s.id !== scenarioId) return s;
      const newStartMonth = s.rateStages.length > 0
         ? Math.max(...s.rateStages.map(r => r.startMonth)) + 12
         : 1;
      return {
        ...s,
        rateStages: [...s.rateStages, { id: generateId(), startMonth: newStartMonth, rate: 2.0 }]
          .sort((a, b) => a.startMonth - b.startMonth)
      };
    })
  })),

  removeRateStage: (scenarioId, stageId) => set((state) => ({
    scenarios: state.scenarios.map(s => {
      if (s.id !== scenarioId) return s;
      return {
        ...s,
        rateStages: s.rateStages.filter(r => r.id !== stageId)
      };
    })
  })),

  updateRateStage: (scenarioId, stageId, field, value) => set((state) => ({
    scenarios: state.scenarios.map(s => {
      if (s.id !== scenarioId) return s;
      return {
        ...s,
        rateStages: s.rateStages.map(r => r.id === stageId ? { ...r, [field]: value } : r)
          .sort((a, b) => a.startMonth - b.startMonth)
      };
    })
  })),

  loadScenarios: (loadedScenarios) => set({ 
    scenarios: loadedScenarios.map(s => ({
      ...s,
      graceMonths: s.graceMonths !== undefined ? s.graceMonths : (s.gracePeriod ? s.gracePeriod * 12 : 0)
    }))
  })
}));

/**
 * ------------------------------------------------------------------
 * 2. HELPER FUNCTIONS
 * ------------------------------------------------------------------
 */

const formatCurrency = (val) => {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0
  }).format(val);
};

const calculatePMT = (principal, monthlyRate, months, mode = 'round') => {
  if (months <= 0) return 0;
  
  let rawPmt = 0;
  if (monthlyRate === 0) {
    rawPmt = principal / months;
  } else {
    rawPmt = (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / 
             (Math.pow(1 + monthlyRate, months) - 1);
  }

  if (mode === 'ceil') return Math.ceil(rawPmt);
  if (mode === 'floor') return Math.floor(rawPmt);
  return Math.round(rawPmt);
};

const calculateSchedule = (amount, rate, totalMonths, extraPayments, graceMonthsInput = 0, strategy = 'reduce_term', isMultiRate = false, rateStages = [], roundingMode = 'round') => {
  if (!amount || !totalMonths) {
    return {
      baseMonthlyPayment: 0,
      totalInterest: 0,
      totalPaid: 0,
      actualMonths: 0,
      schedule: [],
      savedYears: 0,
      graceMonths: 0
    };
  }

  let initialAnnualRate = rate;
  if (isMultiRate && rateStages && rateStages.length > 0) {
    const stage = [...rateStages].reverse().find(s => 1 >= s.startMonth);
    if (stage) initialAnnualRate = stage.rate;
  }

  const initialMonthlyRate = initialAnnualRate / 100 / 12;
  const graceMonths = Math.min(graceMonthsInput || 0, totalMonths - 1);
  let repaymentMonths = totalMonths - graceMonths;

  let currentTargetPayment = calculatePMT(amount, initialMonthlyRate, repaymentMonths, roundingMode);

  let balance = amount;
  let schedule = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let actualMonths = 0;
  
  let firstMonthPayment = 0;
  let previousMonthlyRate = null;

  const maxIterations = totalMonths + 600; 

  for (let month = 1; month <= maxIterations; month++) {
    if (balance <= 0) break;

    const isGracePeriod = month <= graceMonths;

    let currentAnnualRate = rate;
    if (isMultiRate && rateStages && rateStages.length > 0) {
        const stage = [...rateStages].reverse().find(s => month >= s.startMonth);
        if (stage) currentAnnualRate = stage.rate;
    }
    const currentMonthlyRate = currentAnnualRate / 100 / 12;

    const interest = Math.round(balance * currentMonthlyRate);
    
    const rateChanged = previousMonthlyRate !== null && previousMonthlyRate !== currentMonthlyRate;
    if (month === graceMonths + 1 || (!isGracePeriod && rateChanged)) {
        const remainingLoanMonths = repaymentMonths - Math.max(0, month - graceMonths - 1);
        if (remainingLoanMonths > 0) {
           currentTargetPayment = calculatePMT(balance, currentMonthlyRate, remainingLoanMonths, roundingMode);
        }
    }
    previousMonthlyRate = currentMonthlyRate;
    
    const extraRaw = extraPayments.filter(p => p.month === month).reduce((sum, p) => sum + p.amount, 0);
    const extra = Math.min(extraRaw, balance);

    let scheduledPayment = 0;
    
    if (isGracePeriod) {
      scheduledPayment = interest;
    } else {
      scheduledPayment = currentTargetPayment;
    }

    let scheduledPrincipal = isGracePeriod ? 0 : (scheduledPayment - interest);

    let remainingBalanceAfterExtra = balance - extra;
    if (scheduledPrincipal > remainingBalanceAfterExtra) {
      scheduledPrincipal = remainingBalanceAfterExtra;
      scheduledPayment = interest + scheduledPrincipal;
    }

    const finalPayment = scheduledPayment; 
    const totalMonthPay = finalPayment + extra;
    const totalPrincipalPaid = scheduledPrincipal + extra;

    if (month === 1) firstMonthPayment = finalPayment;

    balance -= totalPrincipalPaid;
    if (balance < 10) balance = 0;

    totalInterest += interest;
    totalPaid += totalMonthPay;
    actualMonths = month;

    schedule.push({
      month,
      isGrace: isGracePeriod,
      rate: currentAnnualRate,
      payment: finalPayment,
      principal: scheduledPrincipal,
      interest: interest,
      extra: extra,
      totalPayment: totalMonthPay,
      balance: balance
    });

    if (extra > 0 && balance > 0) {
      if (strategy === 'reduce_payment') {
        let remainingLoanMonths;
        if (isGracePeriod) {
           remainingLoanMonths = repaymentMonths;
        } else {
           const monthsPassedInRepayment = month - graceMonths;
           remainingLoanMonths = repaymentMonths - monthsPassedInRepayment;
        }
        
        if (remainingLoanMonths > 0) {
           currentTargetPayment = calculatePMT(balance, currentMonthlyRate, remainingLoanMonths, roundingMode);
        }
      } 
    }
  }

  return {
    baseMonthlyPayment: firstMonthPayment, 
    repaymentMonthlyPayment: schedule.find(s => !s.isGrace)?.payment || currentTargetPayment,
    totalInterest,
    totalPaid,
    actualMonths,
    schedule,
    savedYears: parseFloat(((totalMonths - actualMonths) / 12).toFixed(1)),
    graceMonths,
    strategy
  };
};

/**
 * ------------------------------------------------------------------
 * 3. COMPONENTS
 * ------------------------------------------------------------------
 */

const ScenarioCard = ({ scenario, active, onSelect }) => {
  const { updateScenario, removeScenario, copyScenario, addExtraPayment, removeExtraPayment, addRateStage, removeRateStage, updateRateStage } = useLoanStore();
  const [extraMonth, setExtraMonth] = useState(13);
  const [extraAmount, setExtraAmount] = useState(100000);
  const [isExpanded, setIsExpanded] = useState(false);

  const result = useMemo(() => 
    calculateSchedule(scenario.amount, scenario.rate, scenario.totalMonths, scenario.extraPayments, scenario.graceMonths, scenario.repaymentStrategy, scenario.isMultiRate, scenario.rateStages, scenario.roundingMode),
    [scenario]
  );

  const handleAddExtra = () => {
    if (extraMonth > scenario.totalMonths) {
      message.warning(`提前還款期數不能超過總期數 (${scenario.totalMonths} 期)`);
      return;
    }
    
    const isDuplicateMonth = scenario.extraPayments.some(pay => pay.month === extraMonth);
    if (isDuplicateMonth) {
      message.warning(`第 ${extraMonth} 期已經有提前還款紀錄，請先刪除舊紀錄再重新新增。`);
      return;
    }

    if(extraMonth > 0 && extraAmount > 0) {
      addExtraPayment(scenario.id, extraMonth, extraAmount);
      setExtraAmount(0);
    }
  };

  const handlePeriodChange = (val) => {
    const numVal = val || 0;
    if (scenario.periodUnit === 'year') {
      updateScenario(scenario.id, 'totalMonths', Math.round(numVal * 12));
    } else {
      updateScenario(scenario.id, 'totalMonths', Math.round(numVal));
    }
  };

  const togglePeriodUnit = () => {
    const newUnit = scenario.periodUnit === 'year' ? 'month' : 'year';
    updateScenario(scenario.id, 'periodUnit', newUnit);
  };

  const displayPeriodValue = scenario.periodUnit === 'year' 
    ? parseFloat((scenario.totalMonths / 12).toFixed(1)) 
    : scenario.totalMonths;

  const displayGraceValue = scenario.periodUnit === 'year' 
    ? parseFloat((scenario.graceMonths / 12).toFixed(1)) 
    : scenario.graceMonths;

  const handleGraceChange = (val) => {
    const numVal = val || 0;
    if (scenario.periodUnit === 'year') {
      updateScenario(scenario.id, 'graceMonths', Math.round(numVal * 12));
    } else {
      updateScenario(scenario.id, 'graceMonths', Math.round(numVal));
    }
  };

  return (
    <div 
      className={`border rounded-xl transition-all duration-300 relative ${active ? 'ring-2 ring-blue-500 shadow-lg bg-white z-10' : 'border-gray-200 bg-gray-50 hover:bg-white'}`}
      onClick={onSelect}
    >
      <div className="p-5">
        <div className="flex justify-between items-center mb-4">
          <input 
            value={scenario.name}
            onChange={(e) => updateScenario(scenario.id, 'name', e.target.value)}
            className="font-bold text-lg text-gray-800 bg-transparent border-b border-dashed border-gray-300 focus:border-blue-500 focus:outline-none w-full mr-2"
          />
          <div className="flex gap-1 shrink-0">
            <Tooltip title="複製此情境">
              <button 
                onClick={(e) => { e.stopPropagation(); copyScenario(scenario.id); }}
                className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors"
              >
                <Copy size={16} />
              </button>
            </Tooltip>
            <Tooltip title="刪除">
              <button 
                onClick={(e) => { e.stopPropagation(); removeScenario(scenario.id); }}
                className="p-1.5 text-gray-400 hover:text-red-500 rounded-md hover:bg-red-50 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-500 block mb-1">貸款金額 (元)</label>
              <InputNumber
                style={{ width: '100%' }}
                size="large"
                value={scenario.amount}
                onChange={(val) => updateScenario(scenario.id, 'amount', val)}
                formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(value) => value?.replace(/\$\s?|(,*)/g, '')}
                placeholder="例：10,000,000"
                controls={false}
                className="rounded-lg"
              />
            </div>

            <div className={scenario.isMultiRate ? "sm:col-span-2" : ""}>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-medium text-gray-500">年利率 (%)</label>
                <Radio.Group
                  size="small"
                  value={scenario.isMultiRate ? 'multi' : 'single'}
                  onChange={e => updateScenario(scenario.id, 'isMultiRate', e.target.value === 'multi')}
                >
                  <Radio.Button value="single">單一</Radio.Button>
                  <Radio.Button value="multi">多段</Radio.Button>
                </Radio.Group>
              </div>
              
              {!scenario.isMultiRate ? (
                <InputNumber
                  style={{ width: '100%' }}
                  size="large"
                  value={scenario.rate}
                  step={0.01}
                  onChange={(val) => updateScenario(scenario.id, 'rate', val)}
                  suffix="%"
                  placeholder="2.1"
                />
              ) : (
                <div className="space-y-2 bg-gray-50 p-3 rounded-lg border border-gray-200 mt-1">
                  {scenario.rateStages.map((stage, idx) => (
                    <div key={stage.id} className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 whitespace-nowrap">第</span>
                      <InputNumber
                        size="small"
                        value={stage.startMonth}
                        onChange={val => updateRateStage(scenario.id, stage.id, 'startMonth', val || 1)}
                        min={1}
                        max={scenario.totalMonths}
                        disabled={idx === 0}
                        className="w-16"
                      />
                      <span className="text-xs text-gray-500 whitespace-nowrap">期起:</span>
                      <InputNumber
                        size="small"
                        value={stage.rate}
                        onChange={val => updateRateStage(scenario.id, stage.id, 'rate', val || 0)}
                        step={0.01}
                        suffix="%"
                        className="flex-1"
                      />
                      {idx > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); removeRateStage(scenario.id, stage.id); }} className="text-gray-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  <Button size="small" type="dashed" onClick={(e) => { e.stopPropagation(); addRateStage(scenario.id); }} block icon={<Plus size={14}/>}>
                    新增利率階段
                  </Button>
                </div>
              )}
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-medium text-gray-500">期限</label>
                <button 
                  onClick={(e) => { e.stopPropagation(); togglePeriodUnit(); }}
                  className="text-[10px] flex items-center bg-gray-200 hover:bg-gray-300 text-gray-700 px-1.5 py-0.5 rounded transition-colors"
                >
                  <ArrowRightLeft size={10} className="mr-1"/>
                  {scenario.periodUnit === 'year' ? '年' : '期(月)'}
                </button>
              </div>
              <div className="relative">
                <InputNumber 
                  style={{ width: '100%' }}
                  size="large"
                  value={displayPeriodValue}
                  onChange={handlePeriodChange}
                  controls={false}
                />
                <span className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none z-10 bg-transparent">
                  {scenario.periodUnit === 'year' ? '年' : '期'}
                </span>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-500 flex items-center mb-1">
                <Hourglass size={12} className="mr-1 text-orange-500" /> 
                寬限期 (單位隨期限切換)
              </label>
              <div className="relative">
                <InputNumber
                  style={{ width: '100%' }}
                  size="large"
                  value={displayGraceValue}
                  onChange={handleGraceChange}
                  min={0}
                  max={scenario.periodUnit === 'year' ? scenario.totalMonths / 12 : scenario.totalMonths}
                  controls={false}
                  placeholder="0"
                />
                <span className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none z-10 bg-transparent">
                  {scenario.periodUnit === 'year' ? '年' : '期'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-gray-100/50 p-3 rounded-lg space-y-3">
             <div>
               <label className="text-xs font-medium text-gray-500 flex items-center mb-1">
                 <Calculator size={12} className="mr-1" />
                 月付金進位方式
               </label>
               <Radio.Group 
                  size="small"
                  value={scenario.roundingMode || 'round'} 
                  onChange={(e) => updateScenario(scenario.id, 'roundingMode', e.target.value)}
                  className="w-full flex"
                  buttonStyle="solid"
               >
                  <Radio.Button value="round" className="flex-1 text-center">四捨五入</Radio.Button>
                  <Radio.Button value="ceil" className="flex-1 text-center">無條件進位</Radio.Button>
                  <Radio.Button value="floor" className="flex-1 text-center">無條件捨去</Radio.Button>
               </Radio.Group>
             </div>

             <div className="pt-2 border-t border-gray-200">
               <label className="text-xs font-medium text-gray-500 flex items-center mb-1">
                 <Settings2 size={12} className="mr-1" />
                 提前還款策略 (若有大額還款)
               </label>
               <Radio.Group 
                  size="small"
                  value={scenario.repaymentStrategy} 
                  onChange={(e) => updateScenario(scenario.id, 'repaymentStrategy', e.target.value)}
                  className="w-full flex"
                  buttonStyle="solid"
               >
                  <Radio.Button value="reduce_term" className="flex-1 text-center">縮短年限</Radio.Button>
                  <Radio.Button value="reduce_payment" className="flex-1 text-center">降低月付</Radio.Button>
               </Radio.Group>
             </div>
          </div>

          <div className="bg-blue-50 rounded-lg p-3 grid grid-cols-2 gap-y-2 gap-x-4 text-sm mt-2">
            <div>
              <span className="text-gray-500 block text-xs">首月付款</span>
              <span className="font-bold text-blue-700">{formatCurrency(result.baseMonthlyPayment)}</span>
              {result.graceMonths > 0 && <span className="text-[10px] text-orange-600 ml-1">(寬限期)</span>}
            </div>
            <div>
              <span className="text-gray-500 block text-xs">總利息支出</span>
              <span className="font-bold text-orange-600">{formatCurrency(result.totalInterest)}</span>
            </div>
            
            {(result.graceMonths > 0 || result.schedule.length > 0) && (
               <div className="col-span-2 pt-2 border-t border-blue-100 mt-1">
                 <span className="text-gray-500 block text-xs">正常攤還期月付金</span>
                 <div className="font-bold text-gray-800">
                   {formatCurrency(result.repaymentMonthlyPayment)}
                   {scenario.extraPayments.length > 0 && scenario.repaymentStrategy === 'reduce_payment' && 
                     <span className="text-green-600 text-xs ml-2">(大額還款後會再降低)</span>
                   }
                 </div>
               </div>
            )}
          </div>

          <div>
            <button 
              onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
              className="flex items-center text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors w-full py-2"
            >
              {isExpanded ? <ChevronUp size={16} className="mr-1"/> : <ChevronDown size={16} className="mr-1"/>}
              設定提前還款
              {scenario.extraPayments.length > 0 && 
                <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  {scenario.extraPayments.length} 筆
                </span>
              }
            </button>
            
            {isExpanded && (
              <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 animate-in fade-in slide-in-from-top-2">
                <div className="flex flex-col sm:flex-row gap-2 items-end mb-3">
                  <div className="w-full sm:w-1/3">
                    <label className="text-xs text-gray-500 block mb-1">第幾期 (月)</label>
                    <InputNumber 
                      style={{ width: '100%' }}
                      value={extraMonth}
                      onChange={(val) => setExtraMonth(val || 1)}
                      min={1}
                      max={scenario.totalMonths}
                      placeholder="期數"
                    />
                  </div>
                  <div className="w-full sm:w-1/2">
                    <label className="text-xs text-gray-500 block mb-1">額外還款金額</label>
                    <InputNumber 
                      style={{ width: '100%' }}
                      value={extraAmount}
                      onChange={(val) => setExtraAmount(val || 0)}
                      formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                      parser={(value) => value?.replace(/\$\s?|(,*)/g, '')}
                      step={10000}
                      placeholder="金額"
                    />
                  </div>
                  <Button 
                    type="primary"
                    onClick={handleAddExtra}
                    className="w-full sm:w-auto bg-green-600 hover:bg-green-500"
                    icon={<Plus size={16} />}
                  >
                    新增
                  </Button>
                </div>

                {scenario.extraPayments.length > 0 ? (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {scenario.extraPayments.map(pay => (
                      <div key={pay.id} className="flex justify-between items-center text-sm bg-white p-2 rounded border border-gray-100 shadow-sm">
                        <span className="text-gray-700">第 {pay.month} 期: <span className="font-medium text-green-700">+{formatCurrency(pay.amount)}</span></span>
                        <button onClick={() => removeExtraPayment(scenario.id, pay.id)} className="text-gray-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-2 text-xs text-gray-400">尚未設定額外還款</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ComparisonChart = ({ scenarios }) => {
  const data = scenarios.map(s => {
    const result = calculateSchedule(s.amount, s.rate, s.totalMonths, s.extraPayments, s.graceMonths, s.repaymentStrategy, s.isMultiRate, s.rateStages, s.roundingMode);
    return {
      name: s.name,
      interest: result.totalInterest,
      principal: s.amount,
      total: result.totalPaid,
      yearsSaved: result.savedYears,
      graceMonths: result.graceMonths,
      strategy: s.repaymentStrategy,
      result
    };
  });

  const maxTotal = Math.max(...data.map(d => d.total)) || 1; 

  return (
    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm h-full">
      <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
        <TrendingDown className="mr-2 text-blue-600" />
        方案效益比較
      </h3>
      
      <div className="space-y-8">
        {data.map((d, idx) => (
          <div key={idx} className="relative group">
            <div className="flex flex-wrap justify-between text-sm mb-1 items-end">
              <div className="flex flex-col">
                <span className="font-bold text-gray-700 flex items-center gap-2">
                   {d.name}
                </span>
                <div className="flex gap-1 mt-1">
                   {d.graceMonths > 0 && <Tag color="orange" className="mr-0 text-[10px]">寬限 {d.graceMonths} 期</Tag>}
                   <Tag color={d.strategy === 'reduce_term' ? 'blue' : 'green'} className="mr-0 text-[10px]">
                      {d.strategy === 'reduce_term' ? '縮短年限' : '降低月付'}
                   </Tag>
                </div>
              </div>
              <span className="text-gray-500 font-medium">總支出: {formatCurrency(d.total)}</span>
            </div>
            
            <div className="h-6 w-full bg-gray-100 rounded-full overflow-hidden flex relative mt-2">
              <div 
                className="h-full bg-blue-300 transition-all duration-500"
                style={{ width: `${(d.principal / maxTotal) * 100}%` }}
              />
              <div 
                className="h-full bg-orange-400 transition-all duration-500"
                style={{ width: `${(d.interest / maxTotal) * 100}%` }}
              />
            </div>
            
            <div className="flex flex-wrap justify-between text-xs mt-1 text-gray-500 gap-y-1">
              <div className="flex gap-4">
                <span className="flex items-center"><div className="w-2 h-2 bg-blue-300 rounded-full mr-1"></div> 本金 {formatCurrency(d.principal)}</span>
                <span className="flex items-center"><div className="w-2 h-2 bg-orange-400 rounded-full mr-1"></div> 利息 {formatCurrency(d.interest)}</span>
              </div>
              {d.yearsSaved > 0 && d.strategy === 'reduce_term' && (
                <span className="text-blue-600 font-bold bg-blue-50 px-2 rounded">
                  提前 {d.yearsSaved} 年還清
                </span>
              )}
               {d.yearsSaved === 0 && d.strategy === 'reduce_payment' && (
                <span className="text-green-600 font-bold bg-green-50 px-2 rounded">
                  月付金已降低
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ScheduleTable = ({ scenario }) => {
  const { schedule, totalInterest, totalPaid, actualMonths, graceMonths } = useMemo(() => 
    calculateSchedule(scenario.amount, scenario.rate, scenario.totalMonths, scenario.extraPayments, scenario.graceMonths, scenario.repaymentStrategy, scenario.isMultiRate, scenario.rateStages, scenario.roundingMode), 
    [scenario]
  );

  const handleExportExcel = async () => {
    const hide = message.loading('準備匯出中...', 0);
    try {
      if (!(window as any).XLSX) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      
      const XLSX = (window as any).XLSX;
      const exportData = [];
      const currencyFormat = '"$"#,##0';
      
      exportData.push(['情境名稱', scenario.name]);
      exportData.push(['總期數', `${actualMonths} 期`]);
      exportData.push(['總利息支出', { v: totalInterest, t: 'n', z: currencyFormat }]);
      exportData.push(['總支出金額', { v: totalPaid, t: 'n', z: currencyFormat }]);
      exportData.push(['提前還款策略', scenario.repaymentStrategy === 'reduce_term' ? '縮短年限' : '降低月付']);
      exportData.push(['利率模式', scenario.isMultiRate ? '多段利率' : '單一利率']);
      
      if (scenario.isMultiRate && scenario.rateStages && scenario.rateStages.length > 0) {
        const stagesStr = scenario.rateStages.map(stage => `第 ${stage.startMonth} 期起: ${stage.rate}%`).join(' / ');
        exportData.push(['利率明細', stagesStr]);
      } else {
        exportData.push(['年利率', `${scenario.rate}%`]);
      }

      exportData.push([]); 

      exportData.push(['期數', '年利率', '本金攤還', '利息支出', '額外還款', '本期總付', '剩餘本金']);

      schedule.forEach(row => {
        const isGraceStr = row.isGrace ? ' (寬限期)' : '';
        exportData.push([
          `第 ${row.month} 期${isGraceStr}`,
          `${row.rate}%`,
          { v: row.principal, t: 'n', z: currencyFormat },
          { v: row.interest, t: 'n', z: currencyFormat },
          { v: row.extra, t: 'n', z: currencyFormat },
          { v: row.totalPayment, t: 'n', z: currencyFormat },
          { v: row.balance, t: 'n', z: currencyFormat }
        ]);
      });

      const ws = XLSX.utils.aoa_to_sheet(exportData);
      
      ws['!cols'] = [
        { wch: 16 }, 
        { wch: 10 }, 
        { wch: 14 }, 
        { wch: 14 }, 
        { wch: 14 }, 
        { wch: 14 }, 
        { wch: 14 }  
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '還款計畫表');

      XLSX.writeFile(wb, `${scenario.name}_還款計畫表.xlsx`);
      
      hide();
      message.success('匯出成功！');
    } catch (error) {
      hide();
      console.error(error);
      message.error('匯出失敗，無法載入必要元件。');
    }
  };

  return (
    <div className="mt-8 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4">
      <div className="p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gray-50">
        <div>
          <h3 className="text-xl font-bold text-gray-800 flex items-center">
            {scenario.name} - 詳細還款計劃表
            {graceMonths > 0 && <span className="ml-3 text-sm bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-normal">含 {graceMonths} 期寬限期</span>}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            共 {actualMonths} 期 ({parseFloat((actualMonths/12).toFixed(1))} 年) | 總利息: {formatCurrency(totalInterest)} | 總支出: {formatCurrency(totalPaid)}
          </p>
        </div>
        <div className="flex items-center gap-3">
           <div className="text-sm px-3 py-1 bg-gray-100 rounded text-gray-600 hidden sm:block">
             策略: {scenario.repaymentStrategy === 'reduce_term' ? '縮短年限' : '降低月付'}
           </div>
           <Button icon={<Download size={16} />} onClick={handleExportExcel} type="default">
             匯出 Excel
           </Button>
        </div>
      </div>
      
      <div className="overflow-x-auto max-h-[600px]">
        <table className="w-full text-sm text-right relative">
          <thead className="bg-gray-100 text-gray-600 font-medium sticky top-0 shadow-sm z-10">
            <tr>
              <th className="p-3 text-center w-20">期數</th>
              <th className="p-3 text-center">年利率</th>
              <th className="p-3">本金攤還</th>
              <th className="p-3">利息支出</th>
              <th className="p-3">額外還款</th>
              <th className="p-3 font-bold text-gray-800">本期總付</th>
              <th className="p-3 text-gray-500">剩餘本金</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {schedule.map((row) => (
              <tr key={row.month} className={`hover:bg-blue-50 transition-colors ${row.extra > 0 ? 'bg-green-50' : ''} ${row.isGrace ? 'bg-orange-50/30' : ''}`}>
                <td className="p-3 text-center font-mono text-gray-500">
                   {row.month} 
                   {row.isGrace && <span className="block text-[9px] text-orange-500 leading-none mt-1">寬限期</span>}
                </td>
                <td className="p-3 text-center text-gray-500">{row.rate}%</td>
                <td className={`p-3 ${row.principal === 0 && !row.isGrace ? 'text-gray-300' : ''}`}>
                    {row.principal === 0 && row.isGrace ? <span className="text-gray-300">-</span> : formatCurrency(row.principal)}
                </td>
                <td className="p-3 text-orange-600">{formatCurrency(row.interest)}</td>
                <td className="p-3">
                  {row.extra > 0 ? (
                    <span className="text-green-600 font-bold">+{formatCurrency(row.extra)}</span>
                  ) : (
                    <span className="text-gray-300">-</span>
                  )}
                </td>
                <td className="p-3 font-bold text-blue-900">{formatCurrency(row.totalPayment)}</td>
                <td className="p-3 text-gray-500">{formatCurrency(row.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default function App() {
  const { scenarios, addScenario, loadScenarios } = useLoanStore() as any;
  const [activeTabId, setActiveTabId] = useState(null);
  const fileInputRef = useRef<HTMLInputElement>(null); 
  
  useEffect(() => {
    if (scenarios.length > 0 && !activeTabId) {
      setActiveTabId(scenarios[0].id);
    }
  }, [scenarios, activeTabId]);

  const activeScenario = scenarios.find(s => s.id === activeTabId) || scenarios[0];

  const handleExportConfig = () => {
    const dataStr = JSON.stringify(scenarios, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `貸款試算設定檔_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    message.success('設定檔已成功匯出！');
  };

  const handleImportConfig = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event: any) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (Array.isArray(importedData) && importedData.length > 0 && importedData[0].id) {
          loadScenarios(importedData);
          setActiveTabId(importedData[0].id); 
          message.success('設定已成功載入！');
        } else {
          message.error('檔案格式不正確！無法辨識為貸款設定檔。');
        }
      } catch (err) {
        message.error('讀取檔案失敗，請確認是否為有效的 JSON 設定檔。');
      }
    };
    reader.readAsText(file);
    e.target.value = null; 
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-20">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <Calculator size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900 hidden sm:block">智慧貸款試算器</h1>
            <h1 className="text-lg font-bold tracking-tight text-gray-900 block sm:hidden">貸款試算</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <input 
              type="file" 
              accept=".json" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleImportConfig}
            />
            
            <Tooltip title="匯入已儲存的設定">
              <Button 
                onClick={() => fileInputRef.current?.click()}
                icon={<Upload size={16} />}
              >
                <span className="hidden sm:inline">載入</span>
              </Button>
            </Tooltip>
            
            <Tooltip title="將目前所有方案下載為檔案">
              <Button 
                onClick={handleExportConfig}
                icon={<Save size={16} />}
              >
                <span className="hidden sm:inline">匯出</span>
              </Button>
            </Tooltip>

            <Button 
              type="primary"
              onClick={addScenario}
              icon={<Plus size={16} />}
              className="bg-blue-600"
            >
              <span className="hidden sm:inline">新增比較情境</span>
              <span className="inline sm:hidden">新增</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-gray-700 flex items-center">
                <LayoutGrid size={20} className="mr-2"/> 設定貸款條件
              </h2>
              <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded-full">{scenarios.length} 個方案</span>
            </div>
            
            <div className="space-y-4">
              {scenarios.map((scenario: any) => (
                <ScenarioCard 
                  key={scenario.id} 
                  scenario={scenario} 
                  active={activeTabId === scenario.id}
                  onSelect={() => setActiveTabId(scenario.id)}
                />
              ))}
            </div>
          </div>

          <div className="lg:col-span-5">
             <div className="sticky top-24">
               <ComparisonChart scenarios={scenarios} />
               
               <div className="mt-4 bg-blue-50 border border-blue-100 p-4 rounded-xl text-sm text-blue-800 shadow-sm hidden sm:block">
                  <div className="font-bold mb-1 flex items-center"><DollarSign size={16} className="mr-1"/> 提示</div>
                  現在您可以在「進階計算設定」中切換模式：
                  <ul className="list-disc list-inside mt-1 ml-1 text-xs text-blue-700">
                    <li>月付金進位：提供四捨五入、無條件進位與捨去，精準貼合各家銀行演算法。</li>
                    <li>提前還款策略：可選「縮短年限」或「降低月付」。</li>
                  </ul>
               </div>
             </div>
          </div>
        </div>

        <div className="mt-12">
          <div className="flex items-center gap-4 mb-6 border-b border-gray-200 pb-1 overflow-x-auto">
            <h2 className="text-lg font-bold text-gray-700 whitespace-nowrap flex items-center mr-4">
              <List size={20} className="mr-2"/> 詳細攤還表
            </h2>
            {scenarios.map((s: any) => (
              <button
                key={s.id}
                onClick={() => setActiveTabId(s.id)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap ${
                  activeTabId === s.id 
                    ? 'bg-white border-b-2 border-blue-600 text-blue-600' 
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>

          {activeScenario && (
            <ScheduleTable scenario={activeScenario} />
          )}
        </div>
      </main>
    </div>
  );
}
