import Ionicons from '@react-native-vector-icons/ionicons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '@/constants/tokens';

/**
 * Date-of-birth field + calendar sheet. Pure JS (no native date picker needed). Birthdays
 * are usually decades back, so it goes Year → Month → Day in three taps instead of paging
 * month by month. Value is "DD/MM/YYYY" — the format the profile forms already validate.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MIN_YEARS_OLD = 5;
const MAX_YEARS_OLD = 100;

type Step = 'year' | 'month' | 'day';
type Parts = { day: number; month: number; year: number };

const pad = (n: number) => String(n).padStart(2, '0');
const format = ({ day, month, year }: Parts) => `${pad(day)}/${pad(month + 1)}/${year}`;
const daysIn = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

function parse(value: string): Parts | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  if (month < 0 || month > 11 || day < 1 || day > daysIn(year, month)) return null;
  return { day, month, year };
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Overrides for the closed field, e.g. to match a screen's own inputs. */
  fieldStyle?: StyleProp<ViewStyle>;
};

export default function DateOfBirthPicker({ value, onChange, placeholder = 'Date of Birth (Optional)', disabled = false, fieldStyle }: Props) {
  const insets = useSafeAreaInsets();
  const today = new Date();
  const latestYear = today.getFullYear() - MIN_YEARS_OLD;
  const years = useMemo(() => Array.from({ length: MAX_YEARS_OLD - MIN_YEARS_OLD + 1 }, (_, i) => latestYear - i), [latestYear]);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('year');
  const [draft, setDraft] = useState<Parts>({ day: 1, month: 0, year: latestYear - 20 });
  const yearListRef = useRef<FlatList<number>>(null);

  const openPicker = () => {
    const current = parse(value);
    setDraft(current || { day: 1, month: 0, year: latestYear - 20 });
    setStep(current ? 'day' : 'year');
    setOpen(true);
  };

  // Scroll the year list so the chosen year is visible.
  useEffect(() => {
    if (!open || step !== 'year') return;
    const row = Math.floor(Math.max(0, years.indexOf(draft.year)) / 4);
    const timer = setTimeout(() => yearListRef.current?.scrollToOffset({ offset: Math.max(0, row * 56 - 112), animated: false }), 50);
    return () => clearTimeout(timer);
  }, [open, step, draft.year, years]);

  const choose = (day: number) => {
    onChange(format({ ...draft, day }));
    setOpen(false);
  };

  const firstWeekday = new Date(draft.year, draft.month, 1).getDay();
  const dayCells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysIn(draft.year, draft.month) }, (_, i) => i + 1)];
  const selected = parse(value);
  const isFuture = (day: number) => new Date(draft.year, draft.month, day) > today;

  const shiftMonth = (delta: number) => {
    const date = new Date(draft.year, draft.month + delta, 1);
    if (date.getFullYear() > latestYear || date.getFullYear() < latestYear - (MAX_YEARS_OLD - MIN_YEARS_OLD)) return;
    setDraft((d) => ({ ...d, month: date.getMonth(), year: date.getFullYear(), day: Math.min(d.day, daysIn(date.getFullYear(), date.getMonth())) }));
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value ? `Date of birth, ${value}. Change` : 'Choose date of birth'}
        disabled={disabled}
        onPress={openPicker}
        style={({ pressed }) => [styles.field, fieldStyle, pressed && { borderColor: T.color.brand }, disabled && { opacity: 0.6 }]}
      >
        <Text style={[styles.fieldText, !value && styles.placeholder]}>{value || placeholder}</Text>
        {value && !disabled ? (
          <Pressable accessibilityLabel="Clear date of birth" hitSlop={10} onPress={() => onChange('')}>
            <Ionicons name="close-circle" size={20} color={T.color.faint} />
          </Pressable>
        ) : (
          <Ionicons name="calendar-outline" size={20} color={T.color.brand} />
        )}
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.shade}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close calendar" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Date of birth</Text>

            {/* Breadcrumb: tap a part to jump back to that step. */}
            <View style={styles.crumbs}>
              <Pressable onPress={() => setStep('day')} disabled={step === 'year'} style={[styles.crumb, step === 'day' && styles.crumbActive]}>
                <Text style={[styles.crumbText, step === 'day' && styles.crumbTextActive]}>{step === 'year' ? 'Day' : pad(draft.day)}</Text>
              </Pressable>
              <Pressable onPress={() => setStep('month')} style={[styles.crumb, step === 'month' && styles.crumbActive]}>
                <Text style={[styles.crumbText, step === 'month' && styles.crumbTextActive]}>{MONTHS[draft.month]}</Text>
              </Pressable>
              <Pressable onPress={() => setStep('year')} style={[styles.crumb, step === 'year' && styles.crumbActive]}>
                <Text style={[styles.crumbText, step === 'year' && styles.crumbTextActive]}>{draft.year}</Text>
              </Pressable>
            </View>

            {step === 'year' ? (
              <>
                <Text style={styles.stepHint}>Select your birth year</Text>
                <FlatList
                  ref={yearListRef}
                  data={years}
                  numColumns={4}
                  keyExtractor={(year) => String(year)}
                  style={{ maxHeight: 280 }}
                  getItemLayout={(_, index) => ({ length: 56, offset: 56 * Math.floor(index / 4), index })}
                  renderItem={({ item: year }) => {
                    const active = year === draft.year;
                    return (
                      <Pressable
                        onPress={() => {
                          setDraft((d) => ({ ...d, year, day: Math.min(d.day, daysIn(year, d.month)) }));
                          setStep('month');
                        }}
                        style={[styles.cell, styles.yearCell, active && styles.cellActive]}
                      >
                        <Text style={[styles.cellText, active && styles.cellTextActive]}>{year}</Text>
                      </Pressable>
                    );
                  }}
                />
              </>
            ) : null}

            {step === 'month' ? (
              <>
                <Text style={styles.stepHint}>Select month</Text>
                <View style={styles.grid}>
                  {MONTHS.map((label, month) => {
                    const active = month === draft.month;
                    return (
                      <Pressable
                        key={label}
                        onPress={() => {
                          setDraft((d) => ({ ...d, month, day: Math.min(d.day, daysIn(d.year, month)) }));
                          setStep('day');
                        }}
                        style={[styles.cell, styles.monthCell, active && styles.cellActive]}
                      >
                        <Text style={[styles.cellText, active && styles.cellTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {step === 'day' ? (
              <>
                <View style={styles.monthNav}>
                  <Pressable accessibilityLabel="Previous month" hitSlop={10} onPress={() => shiftMonth(-1)}>
                    <Ionicons name="chevron-back" size={22} color={T.color.ink} />
                  </Pressable>
                  <Text style={styles.monthNavText}>
                    {MONTHS[draft.month]} {draft.year}
                  </Text>
                  <Pressable accessibilityLabel="Next month" hitSlop={10} onPress={() => shiftMonth(1)}>
                    <Ionicons name="chevron-forward" size={22} color={T.color.ink} />
                  </Pressable>
                </View>
                <View style={styles.grid}>
                  {WEEKDAYS.map((label, index) => (
                    <View key={`${label}-${index}`} style={styles.dayCell}>
                      <Text style={styles.weekday}>{label}</Text>
                    </View>
                  ))}
                  {dayCells.map((day, index) => {
                    if (!day) return <View key={`blank-${index}`} style={styles.dayCell} />;
                    const active = selected?.day === day && selected.month === draft.month && selected.year === draft.year;
                    const blocked = isFuture(day);
                    return (
                      <Pressable
                        key={day}
                        disabled={blocked}
                        onPress={() => choose(day)}
                        accessibilityLabel={`${day} ${MONTHS[draft.month]} ${draft.year}`}
                        style={[styles.dayCell, styles.dayButton, active && styles.cellActive, blocked && { opacity: 0.3 }]}
                      >
                        <Text style={[styles.cellText, active && styles.cellTextActive]}>{day}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            <Pressable onPress={() => setOpen(false)} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: T.color.line,
    borderRadius: 8,
    backgroundColor: T.color.surface,
    paddingHorizontal: 14,
    marginBottom: 12,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldText: { fontSize: 16, color: T.color.ink },
  placeholder: { color: T.color.faint },
  shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: T.color.line, marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: T.color.ink, textAlign: 'center' },
  crumbs: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 },
  crumb: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: T.color.canvas },
  crumbActive: { backgroundColor: T.color.brandSoft },
  crumbText: { fontSize: 14, fontWeight: '700', color: T.color.muted },
  crumbTextActive: { color: T.color.brand },
  stepHint: { marginTop: 14, marginBottom: 8, fontSize: 12.5, fontWeight: '700', color: T.color.faint, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  cell: { alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  cellActive: { backgroundColor: T.color.brand },
  cellText: { fontSize: 15, fontWeight: '600', color: T.color.ink },
  cellTextActive: { color: '#fff', fontWeight: '800' },
  yearCell: { width: '25%', height: 48, marginVertical: 4 },
  monthCell: { width: '33.33%', height: 52, marginVertical: 4 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 8 },
  monthNavText: { fontSize: 16, fontWeight: '800', color: T.color.ink },
  dayCell: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' },
  dayButton: { borderRadius: 22 },
  weekday: { fontSize: 12, fontWeight: '700', color: T.color.faint },
  cancel: { marginTop: 12, alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontSize: 15, fontWeight: '700', color: T.color.muted },
});
