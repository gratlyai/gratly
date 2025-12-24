import React, { useState, useEffect, useCallback } from 'react';

type View = 'existing' | 'create';

interface FormApi {
  id: number;
  user_id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  order_calculation: string | null;
  tip_pool_type: string | null;
  funds_from: Array<{ name: string }>;
  tip_division: string | null;
  positions_pay_into: string[];
  positions_paid_from_sales: string[];
  positions_paid_from_tips: string[];
  tip_percentages: Record<string, number>;
  flat_rate_positions: string[];
  flat_rate_amount: number | null;
  flat_rate_type: string | null;
  created_at: string;
}

interface Fund {
  name: string;
  selected: boolean;
}
const GratlyFormsSystem: React.FC = () => {
  const [userId, setUserId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<View>('existing');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [forms, setForms] = useState<FormApi[]>([]);
  const [isLoadingForms, setIsLoadingForms] = useState<boolean>(false);
  const [formsError, setFormsError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>('');
  const [submitSuccess, setSubmitSuccess] = useState<string>('');
  const [editingFormId, setEditingFormId] = useState<number | null>(null);
  const [selectedFormIds, setSelectedFormIds] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>('');
  const [showCancelConfirm, setShowCancelConfirm] = useState<boolean>(false);
  // Form creation states
  const [formName, setFormName] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [orderCalculation, setOrderCalculation] = useState<'opened' | 'closed'>('opened');
  const [tipPoolType, setTipPoolType] = useState<'individual' | 'group' | 'points'>('individual');
  const [fundsFrom, setFundsFrom] = useState<Fund[]>([
    { name: 'Credit Cards', selected: false },
    { name: 'Cash', selected: false },
    { name: 'Gratuity', selected: false },
    { name: 'Delivery Fee', selected: false },
    { name: 'Service Charge', selected: false },
    { name: 'Gift Card', selected: false },
    { name: 'Other', selected: false },
    { name: 'House Account', selected: false }
  ]);
  const positionOptions = [
    'Baker',
    'Banquet Manager',
    'Bar Back',
    'Barista',
    'Bartender',
    'Beverage Manager',
    'Broiler Cook/Fullservice',
    'Broiler Cook/Quickservice',
    'Bus person/Busser',
    'Cashier',
    'Catering Manager',
    'Controller',
    'Counter Server',
    "Dining room manager/Maître D'hotel",
    'Dishwasher',
    'Executive Chef',
    'Expediter',
    'Food and Beverage Director',
    'Fry/Sauté Cook',
    'Garde Manger/Pantry Chef',
    'General Manager Fullservice',
    'General Manager Quickservice',
    'Grill Cook',
    'Host',
    'Kitchen Manager',
    'Line Cook',
    'Manager',
    'Pastry Chef',
    'Public Relations/ Marketing Manager',
    'Server',
    'Service Manager',
    'Shift Manager',
    'Sommelier',
    'Soup & Sauce Cook/Potager & Saucier',
    'Sous Chef',
    'Sushi Chef',
    'To-Go Specialist',
    'Wine steward',
    'Chief Executive Officer',
    'Chief Financial Officer'
  ];
  const [positionsPayInto, setPositionsPayInto] = useState<string[]>(['Server']);
  const [tipDivision, setTipDivision] = useState<string>('Equally regardless of hours worked');
  const [positionsPaidFromSales, setPositionsPaidFromSales] = useState<string[]>([]);
  const [positionsPaidFromTips, setPositionsPaidFromTips] = useState<string[]>(['Host', 'Bartender', 'Bus person/Busser']);
  const [flatRatePositions, setFlatRatePositions] = useState<string[]>(['House Account']);
  const [flatRateAmount, setFlatRateAmount] = useState<string>('1.66');
  const [flatRateType, setFlatRateType] = useState<'divided' | 'individual' | 'perHour'>('individual');
  const [tipPercentages, setTipPercentages] = useState<Record<string, number>>({});
  const [newPayIntoPosition, setNewPayIntoPosition] = useState<string>('');
  const [newPaidFromTipsPosition, setNewPaidFromTipsPosition] = useState<string>('');
  const [newFlatRatePosition, setNewFlatRatePosition] = useState<string>('');

  useEffect(() => {
    const storedUserId = localStorage.getItem('userId');
    if (storedUserId) {
      const parsedId = Number(storedUserId);
      if (Number.isFinite(parsedId)) {
        setUserId(parsedId);
      }
    }
  }, []);

  useEffect(() => {
    setTipPercentages((prev) => {
      const next: Record<string, number> = {};
      positionsPaidFromTips.forEach((position) => {
        next[position] = typeof prev[position] === 'number' ? prev[position] : 0;
      });
      return next;
    });
  }, [positionsPaidFromTips]);

  const fetchForms = useCallback(async () => {
    if (userId === null) {
      return;
    }
    setIsLoadingForms(true);
    setFormsError('');
    try {
      const res = await fetch(`http://127.0.0.1:8000/forms?user_id=${userId}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch forms (${res.status})`);
      }
      const data = await res.json();
      setForms(data);
      setSelectedFormIds(new Set());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch forms';
      setFormsError(message);
    } finally {
      setIsLoadingForms(false);
    }
  }, [userId]);

  useEffect(() => {
    if (activeView === 'existing') {
      fetchForms();
    }
  }, [activeView, fetchForms]);

  const formatDateRange = (start: string | null, end: string | null) => {
    if (!start && !end) return '—';
    if (start && end) return `${start} - ${end}`;
    return start || end || '—';
  };

  const formatTimeRange = (start: string | null, end: string | null) => {
    if (!start && !end) return '—';
    if (start && end) return `${start} - ${end}`;
    return start || end || '—';
  };

  const toggleSelectForm = (formId: number) => {
    setSelectedFormIds((prev) => {
      const next = new Set(prev);
      if (next.has(formId)) {
        next.delete(formId);
      } else {
        next.add(formId);
      }
      return next;
    });
  };

  const toggleSelectAllForms = () => {
    setSelectedFormIds((prev) => {
      if (forms.length > 0 && prev.size === forms.length) {
        return new Set();
      }
      return new Set(forms.map((form) => form.id));
    });
  };

  const confirmDeleteSelected = async () => {
    if (userId === null) {
      setDeleteError('Please log in again to delete forms.');
      return;
    }
    const formIds = Array.from(selectedFormIds);
    if (formIds.length === 0) {
      setDeleteError('Select at least one form to delete.');
      return;
    }

    setIsDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch('http://127.0.0.1:8000/forms', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, form_ids: formIds })
      });
      if (!res.ok) {
        let message = `Failed to delete forms (${res.status})`;
        try {
          const data = await res.json();
          message = data.detail || message;
        } catch {
          // Ignore JSON parsing errors.
        }
        throw new Error(message);
      }
      setShowDeleteConfirm(false);
      await fetchForms();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete forms';
      setDeleteError(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleFund = (index: number) => {
    const updated = [...fundsFrom];
    updated[index].selected = !updated[index].selected;
    setFundsFrom(updated);
  };

  const removePosition = (position: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(prev => prev.filter(p => p !== position));
  };

  const addPosition = (
    position: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    resetter: React.Dispatch<React.SetStateAction<string>>
  ) => {
    const trimmed = position.trim();
    if (!trimmed) {
      return;
    }
    setter((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    resetter('');
  };

  const updateTipPercentage = (position: string, value: string) => {
    const numericValue = Number(value);
    setTipPercentages((prev) => ({
      ...prev,
      [position]: Number.isFinite(numericValue) ? numericValue : 0
    }));
  };

  const tipPercentageTotal = positionsPaidFromTips.reduce((sum, position) => {
    const value = tipPercentages[position] ?? 0;
    return sum + value;
  }, 0);

  const resetFormFields = () => {
    setEditingFormId(null);
    setFormName('');
    setStartDate('');
    setEndDate('');
    setStartTime('');
    setEndTime('');
    setOrderCalculation('opened');
    setTipPoolType('individual');
    setFundsFrom((prev) => prev.map((fund) => ({ ...fund, selected: false })));
    setPositionsPayInto(['Server']);
    setTipDivision('Equally regardless of hours worked');
    setPositionsPaidFromSales([]);
    setPositionsPaidFromTips(['Host', 'Bartender', 'Bus person/Busser']);
    setTipPercentages({});
    setFlatRatePositions(['House Account']);
    setFlatRateAmount('1.66');
    setFlatRateType('individual');
    setNewPayIntoPosition('');
    setNewPaidFromTipsPosition('');
    setNewFlatRatePosition('');
  };

  const startEditForm = (form: FormApi) => {
    setEditingFormId(form.id);
    setFormName(form.name || '');
    setStartDate(form.start_date || '');
    setEndDate(form.end_date || '');
    setStartTime(form.start_time || '');
    setEndTime(form.end_time || '');
    setOrderCalculation((form.order_calculation as 'opened' | 'closed') || 'opened');
    setTipPoolType((form.tip_pool_type as 'individual' | 'group' | 'points') || 'individual');
    setFundsFrom((prev) =>
      prev.map((fund) => ({
        ...fund,
        selected: form.funds_from?.some((selectedFund) => selectedFund.name === fund.name) || false
      }))
    );
    setPositionsPayInto(form.positions_pay_into || []);
    setTipDivision(form.tip_division || 'Equally regardless of hours worked');
    setPositionsPaidFromSales(form.positions_paid_from_sales || []);
    setTipPercentages(form.tip_percentages || {});
    setPositionsPaidFromTips(form.positions_paid_from_tips || []);
    setFlatRatePositions(form.flat_rate_positions || []);
    setFlatRateAmount(form.flat_rate_amount !== null && form.flat_rate_amount !== undefined ? String(form.flat_rate_amount) : '');
    setFlatRateType((form.flat_rate_type as 'divided' | 'individual' | 'perHour') || 'individual');
    setNewPayIntoPosition('');
    setNewPaidFromTipsPosition('');
    setNewFlatRatePosition('');
    setActiveView('create');
  };

  const handleCreateForm = async () => {
    if (userId === null) {
      setSubmitError('Please log in again to create a form.');
      return;
    }
    if (!formName.trim()) {
      setSubmitError('Form name is required.');
      return;
    }
    if (positionsPaidFromTips.length > 0 && Math.abs(tipPercentageTotal - 100) > 0.01) {
      setSubmitError('Tip percentages must total 100%.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    setSubmitSuccess('');

    const selectedFunds = fundsFrom
      .filter((fund) => fund.selected)
      .map((fund) => ({ name: fund.name }));

    const flatRateAmountValue = parseFloat(flatRateAmount);
    const parsedFlatRateAmount = Number.isFinite(flatRateAmountValue) ? flatRateAmountValue : null;

    const payload = {
      user_id: userId,
      name: formName.trim(),
      start_date: startDate || null,
      end_date: endDate || null,
      start_time: startTime || null,
      end_time: endTime || null,
      order_calculation: orderCalculation,
      tip_pool_type: tipPoolType,
      funds_from: selectedFunds,
      tip_division: tipDivision,
      positions_pay_into: positionsPayInto,
      positions_paid_from_sales: positionsPaidFromSales,
      positions_paid_from_tips: positionsPaidFromTips,
      tip_percentages: tipPercentages,
      flat_rate_positions: flatRatePositions,
      flat_rate_amount: parsedFlatRateAmount,
      flat_rate_type: flatRateType
    };

    try {
      const endpoint = editingFormId
        ? `http://127.0.0.1:8000/forms/${editingFormId}`
        : 'http://127.0.0.1:8000/forms';
      const method = editingFormId ? 'PUT' : 'POST';
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let message = `Failed to create form (${res.status})`;
        try {
          const data = await res.json();
          message = data.detail || message;
        } catch {
          // Ignore JSON parsing errors.
        }
        throw new Error(message);
      }

      await fetchForms();
      setSubmitSuccess(editingFormId ? 'Form updated successfully.' : 'Form saved successfully.');
      setActiveView('existing');
      resetFormFields();
      window.setTimeout(() => setSubmitSuccess(''), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create form';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-8">
      {activeView === 'existing' ? (
            <div>
              {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                  <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Delete tip pool schedules?</h3>
                    <p className="text-sm text-gray-700 mb-4">
                      You are about to delete {selectedFormIds.size} schedule{selectedFormIds.size === 1 ? '' : 's'}.
                      This action cannot be undone.
                    </p>
                    {deleteError && (
                      <p className="text-sm text-red-600 mb-3">{deleteError}</p>
                    )}
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-4 py-2 rounded-lg border border-gray-300 text-gray-900 font-semibold hover:bg-gray-100"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={confirmDeleteSelected}
                        disabled={isDeleting}
                        className="px-4 py-2 rounded-lg bg-red-600 text-black font-semibold hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isDeleting ? 'Deleting...' : 'Yes, delete'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Header */}
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">Tip Pool Settings</h1>
                  <h2 className="text-xl font-semibold text-gray-700 mt-2">Primary Tip Pools</h2>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        resetFormFields();
                        setActiveView('create');
                      }}
                      className="bg-[#cab99a] text-black px-6 py-3 rounded-lg font-semibold hover:bg-[#bfa986] transition-all shadow-md"
                    >
                      Create Tip Pool
                    </button>
                    <button
                      onClick={() => {
                        setDeleteError('');
                        setShowDeleteConfirm(true);
                      }}
                      disabled={selectedFormIds.size === 0}
                      className="border border-gray-300 text-gray-900 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete Selected
                    </button>
                  </div>
                  <div className="flex gap-2 border border-gray-300 rounded-lg p-1">
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-2 rounded ${viewMode === 'list' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
                    >
                      ☰
                    </button>
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-2 rounded ${viewMode === 'grid' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}
                    >
                      ▦
                    </button>
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={forms.length > 0 && selectedFormIds.size === forms.length}
                          onChange={toggleSelectAllForms}
                        />
                      </th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Name</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Status</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Pool Type</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Tip Division</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Days</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Time</th>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {isLoadingForms ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-6 text-center text-sm text-gray-600">
                          Loading forms...
                        </td>
                      </tr>
                    ) : formsError ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-6 text-center text-sm text-red-600">
                          {formsError}
                        </td>
                      </tr>
                    ) : forms.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-6 text-center text-sm text-gray-600">
                          No forms yet. Create your first tip pool.
                        </td>
                      </tr>
                    ) : (
                      forms.map((form) => {
                        const status = form.start_date || form.start_time ? 'scheduled' : 'draft';
                        return (
                          <tr key={form.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4">
                              <input
                                type="checkbox"
                                className="rounded"
                                checked={selectedFormIds.has(form.id)}
                                onChange={() => toggleSelectForm(form.id)}
                              />
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900 font-medium">{form.name}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">{status}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">{form.tip_pool_type || '—'}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">{form.tip_division || '—'}</td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                              {formatDateRange(form.start_date, form.end_date)}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                              {formatTimeRange(form.start_time, form.end_time)}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600">
                              <button
                                type="button"
                                onClick={() => startEditForm(form)}
                                className="text-sm font-semibold text-gray-900 hover:text-gray-700"
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 text-sm text-gray-600 text-right">
                  Total Rows: {forms.length}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto">
              <h1 className="text-3xl font-bold text-gray-900 mb-8">
                {editingFormId ? 'Edit Form' : 'Create New Form'}
              </h1>
              
              <div className="space-y-8">
                {/* Form Name */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-4">Form Details</h2>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Form Name</label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
                      placeholder="Enter form name"
                    />
                  </div>
                </div>

                {/* Schedule */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-4">Schedule</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Start Time</label>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">End Time</label>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none"
                      />
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">How orders will be calculated</label>
                    <div className="flex gap-4">
                      <label className="flex items-center">
                        <input
                          type="radio"
                          checked={orderCalculation === 'opened'}
                          onChange={() => setOrderCalculation('opened')}
                          className="mr-2"
                        />
                        <span className="text-sm text-gray-700">Opened</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="radio"
                          checked={orderCalculation === 'closed'}
                          onChange={() => setOrderCalculation('closed')}
                          className="mr-2"
                        />
                        <span className="text-sm text-gray-700">Closed</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Funds */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-4">Funds</h2>
                  <div className="mb-4">
                    <p className="font-medium text-gray-900 mb-2">Where are the funds coming from?</p>
                    <p className="text-sm text-gray-600 mb-4">Select all that apply</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {fundsFrom.map((fund, index) => (
                      <button
                        key={fund.name}
                        onClick={() => toggleFund(index)}
                        className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                          fund.selected
                            ? 'bg-[#cab99a] text-black'
                            : 'bg-white text-gray-900 border-2 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {fund.name}
                      </button>
                    ))}
                  </div>
                  
                  <div className="mt-6">
                    <p className="font-medium text-gray-900 mb-3">Select Tip Pool Type</p>
                    <div className="space-y-2">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={tipPoolType === 'individual'}
                          onChange={() => setTipPoolType('individual')}
                          className="mr-3 w-5 h-5"
                        />
                        <span className="text-gray-900">Individual Contributor</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={tipPoolType === 'group'}
                          onChange={() => setTipPoolType('group')}
                          className="mr-3 w-5 h-5"
                        />
                        <span className="text-gray-900">Group Contributor</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={tipPoolType === 'points'}
                          onChange={() => setTipPoolType('points')}
                          className="mr-3 w-5 h-5"
                        />
                        <span className="text-gray-900">Points</span>
                      </label>
                    </div>
                  </div>

                  <div className="mt-6">
                    <p className="font-medium text-gray-900 mb-3">What positions pay into this pool?</p>
                    <div className="flex flex-col gap-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          list="positions-pay-into"
                          value={newPayIntoPosition}
                          onChange={(e) => setNewPayIntoPosition(e.target.value)}
                          placeholder="Type or choose a position"
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none"
                        />
                        <select
                          value=""
                          onChange={(e) => addPosition(e.target.value, setPositionsPayInto, setNewPayIntoPosition)}
                          className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                        >
                          <option value="" disabled>Select</option>
                          {positionOptions.map((option) => (
                            <option key={`pay-into-select-${option}`} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => addPosition(newPayIntoPosition, setPositionsPayInto, setNewPayIntoPosition)}
                          className="px-4 py-2 bg-[#cab99a] text-black rounded-lg font-semibold hover:bg-[#bfa986] transition-all"
                        >
                          Add
                        </button>
                      </div>
                      <datalist id="positions-pay-into">
                        {positionOptions.map((option) => (
                          <option key={`pay-into-${option}`} value={option} />
                        ))}
                      </datalist>
                      <div className="border border-gray-300 rounded-lg p-3 flex flex-wrap gap-2">
                      {positionsPayInto.map((pos) => (
                        <span key={pos} className="bg-gray-100 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                          {pos}
                          <button onClick={() => removePosition(pos, setPositionsPayInto)} className="text-gray-500 hover:text-gray-700">×</button>
                        </span>
                      ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Recipients */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-4">Recipients</h2>
                  
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block font-medium text-gray-900 mb-3">How will tips be divided among staff?</label>
                      <select
                        value={tipDivision}
                        onChange={(e) => setTipDivision(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none"
                      >
                        <option>Equally regardless of hours worked</option>
                        <option>Based on hours worked</option>
                        <option>Based on points</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-medium text-gray-900 mb-3">What positions get paid from sales?</label>
                      <select className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none">
                        <option>Roles</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-6">
                    <label className="block font-medium text-gray-900 mb-3">What positions get paid from tips?</label>
                    <div className="flex flex-col gap-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          list="positions-paid-from-tips"
                          value={newPaidFromTipsPosition}
                          onChange={(e) => setNewPaidFromTipsPosition(e.target.value)}
                          placeholder="Type or choose a position"
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none"
                        />
                        <select
                          value=""
                          onChange={(e) => addPosition(e.target.value, setPositionsPaidFromTips, setNewPaidFromTipsPosition)}
                          className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                        >
                          <option value="" disabled>Select</option>
                          {positionOptions.map((option) => (
                            <option key={`paid-from-tips-select-${option}`} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => addPosition(newPaidFromTipsPosition, setPositionsPaidFromTips, setNewPaidFromTipsPosition)}
                          className="px-4 py-2 bg-[#cab99a] text-black rounded-lg font-semibold hover:bg-[#bfa986] transition-all"
                        >
                          Add
                        </button>
                      </div>
                      <datalist id="positions-paid-from-tips">
                        {positionOptions.map((option) => (
                          <option key={`paid-from-tips-${option}`} value={option} />
                        ))}
                      </datalist>
                      <div className="border border-gray-300 rounded-lg p-3 flex flex-wrap gap-2">
                        {positionsPaidFromTips.map((pos) => (
                          <span key={pos} className="bg-gray-100 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                            {pos}
                            <button onClick={() => removePosition(pos, setPositionsPaidFromTips)} className="text-gray-500 hover:text-gray-700">×</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <label className="block font-medium text-gray-900 mb-3">Tip percentages (must total 100%)</label>
                    {positionsPaidFromTips.length === 0 ? (
                      <p className="text-sm text-gray-600">Add positions paid from tips to set percentages.</p>
                    ) : (
                      <div className="space-y-3">
                        {positionsPaidFromTips.map((position) => (
                          <div key={`percent-${position}`} className="flex items-center gap-3">
                            <span className="flex-1 text-sm text-gray-900">{position}</span>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={tipPercentages[position] ? String(tipPercentages[position]) : ''}
                              onChange={(e) => updateTipPercentage(position, e.target.value)}
                              placeholder="0"
                              className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-gray-900 outline-none"
                            />
                            <span className="text-sm text-gray-600">%</span>
                          </div>
                        ))}
                        <div className="text-sm text-gray-700">
                          Total: {tipPercentageTotal.toFixed(2)}%
                        </div>
                        {Math.abs(tipPercentageTotal - 100) > 0.01 && (
                          <div className="text-sm text-red-600">
                            Percentages must total 100%.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-6">
                    <label className="block font-medium text-gray-900 mb-3">What positions will receive a flat rate?</label>
                    <div className="flex flex-col gap-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          list="positions-flat-rate"
                          value={newFlatRatePosition}
                          onChange={(e) => setNewFlatRatePosition(e.target.value)}
                          placeholder="Type or choose a position"
                          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none"
                        />
                        <select
                          value=""
                          onChange={(e) => addPosition(e.target.value, setFlatRatePositions, setNewFlatRatePosition)}
                          className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
                        >
                          <option value="" disabled>Select</option>
                          {positionOptions.map((option) => (
                            <option key={`flat-rate-select-${option}`} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => addPosition(newFlatRatePosition, setFlatRatePositions, setNewFlatRatePosition)}
                          className="px-4 py-2 bg-[#cab99a] text-black rounded-lg font-semibold hover:bg-[#bfa986] transition-all"
                        >
                          Add
                        </button>
                      </div>
                      <datalist id="positions-flat-rate">
                        {positionOptions.map((option) => (
                          <option key={`flat-rate-${option}`} value={option} />
                        ))}
                      </datalist>
                      <div className="border border-gray-300 rounded-lg p-3 flex flex-wrap gap-2">
                        {flatRatePositions.map((pos) => (
                          <span key={pos} className="bg-gray-100 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                            {pos}
                            <button onClick={() => removePosition(pos, setFlatRatePositions)} className="text-gray-500 hover:text-gray-700">×</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Flat Rates */}
                <div className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-xl font-bold text-gray-900 mb-4">Flat Rates</h2>
                  <div className="flex items-center gap-6">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 mb-2">Position</p>
                      <p className="text-gray-900">House Account</p>
                    </div>
                    <div className="flex-1">
                      <label className="block font-medium text-gray-900 mb-2">Flat Rate Amount</label>
                      <input
                        type="text"
                        value={flatRateAmount}
                        onChange={(e) => setFlatRateAmount(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 outline-none"
                        placeholder="$1.66"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 mb-3">Distribution Type</p>
                      <div className="flex gap-4">
                        <label className="flex items-center">
                          <input
                            type="radio"
                            checked={flatRateType === 'divided'}
                            onChange={() => setFlatRateType('divided')}
                            className="mr-2"
                          />
                          <span className="text-sm">Divided</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            checked={flatRateType === 'individual'}
                            onChange={() => setFlatRateType('individual')}
                            className="mr-2"
                          />
                          <span className="text-sm">Individual</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            checked={flatRateType === 'perHour'}
                            onChange={() => setFlatRateType('perHour')}
                            className="mr-2"
                          />
                          <span className="text-sm">Per Hour</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="flex items-center justify-between">
                  {submitError ? (
                    <p className="text-sm text-red-600">{submitError}</p>
                  ) : submitSuccess ? (
                    <p className="text-sm text-green-700">{submitSuccess}</p>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        resetFormFields();
                        setActiveView('existing');
                      }}
                      className="border border-gray-300 text-gray-900 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-all shadow-lg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateForm}
                      disabled={isSubmitting}
                    className="bg-[#cab99a] text-black px-8 py-3 rounded-lg font-semibold hover:bg-[#bfa986] transition-all shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? 'Creating...' : 'Create Form'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
    </div>
  );
};

export default GratlyFormsSystem;
