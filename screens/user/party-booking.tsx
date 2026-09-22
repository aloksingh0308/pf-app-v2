import { PartyColors } from '@/constants/partyTheme';
import { showAlert } from '@/services/alertService';
import {
  createPartyBooking,
  fetchActiveDecorationPackages,
  fetchActivePartyCoupons,
  fetchActivePartyMenus,
  fetchPartyMenuItems,
  getPartyCouponUsageCountForCustomer,
  groupPartyMenuItemsIntoSteps,
  validatePartyCoupon,
} from '@/services/partyBookingService';
import { RootState } from '@/store';
import {
  AppliedPartyCoupon,
  DecorationPackage,
  PARTY_BOOKING_OCCASIONS,
  PartyCoupon,
  PartyMenu,
  PartyMenuItem,
  PartyMenuStep,
  PartySelectedItem,
  PlatterType,
} from '@/types/PartyBooking';
import { calculatePartyPlatterPrice, PartyPriceLineItem } from '@/utils/partyPlatterPricing';
import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, LayoutChangeEvent, Platform, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import styled from 'styled-components/native';
import ImageView from 'react-native-image-viewing';
import type { ImageSource } from 'react-native-image-viewing/dist/@types';

const FALLBACK_LOGO = require('../../assets/images/logo.png');
const imageSourceOrLogo = (uri?: string | null) => (uri ? { uri } : FALLBACK_LOGO);

type ItemStepPhase = { kind: 'item-step'; step: number };
type FlowPhase = 'menu-select' | 'platter' | 'quantity' | ItemStepPhase | 'review' | 'decoration' | 'details';

type CustomerForm = {
  name: string;
  mobile: string;
  eventDate: string;
  eventTime: string;
  address: string;
  occasion: string;
  specialInstructions: string;
};

const EMPTY_FORM: CustomerForm = {
  name: '',
  mobile: '',
  eventDate: '',
  eventTime: '',
  address: '',
  occasion: PARTY_BOOKING_OCCASIONS[0],
  specialInstructions: '',
};

const isItemStepPhase = (phase: FlowPhase): phase is ItemStepPhase => (
  typeof phase === 'object' && phase.kind === 'item-step'
);

export default function PartyBookingScreen() {
  const insets = useSafeAreaInsets();
  const authUser = useSelector((state: RootState) => state.auth.user);

  const [loading, setLoading] = useState(true);
  const [menus, setMenus] = useState<PartyMenu[]>([]);
  const [selectedMenu, setSelectedMenu] = useState<PartyMenu | null>(null);
  const [menuItems, setMenuItems] = useState<PartyMenuItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);

  const [platterTypeId, setPlatterTypeId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(10);
  const [selectionsByStep, setSelectionsByStep] = useState<Record<number, string[]>>({});
  const [decorationPackages, setDecorationPackages] = useState<DecorationPackage[]>([]);
  const [decorationLoading, setDecorationLoading] = useState(true);
  const [decorationPackageId, setDecorationPackageId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [bookingComplete, setBookingComplete] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);
  const [coupons, setCoupons] = useState<PartyCoupon[]>([]);
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ coupon: PartyCoupon; discountAmount: number } | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const activeMenus = await fetchActivePartyMenus();
        setMenus(activeMenus);
        if (activeMenus.length === 1) {
          setSelectedMenu(activeMenus[0]);
        }
      } catch (error) {
        console.warn('Failed to load party menus.', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const packages = await fetchActiveDecorationPackages();
        setDecorationPackages(packages);
      } catch (error) {
        console.warn('Failed to load decoration packages.', error);
      } finally {
        setDecorationLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const activeCoupons = await fetchActivePartyCoupons();
        setCoupons(activeCoupons);
      } catch (error) {
        console.warn('Failed to load party coupons.', error);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedMenu?.firebaseId) {
      setMenuItems([]);
      return;
    }

    (async () => {
      setItemsLoading(true);
      try {
        const items = await fetchPartyMenuItems(selectedMenu.firebaseId);
        setMenuItems(items);
      } catch (error) {
        console.warn('Failed to load party menu items.', error);
        setMenuItems([]);
      } finally {
        setItemsLoading(false);
      }
    })();
  }, [selectedMenu?.firebaseId]);

  const steps = useMemo<PartyMenuStep[]>(() => groupPartyMenuItemsIntoSteps(menuItems), [menuItems]);

  const flow = useMemo<FlowPhase[]>(() => {
    const phases: FlowPhase[] = [];
    if (menus.length > 1) phases.push('menu-select');
    phases.push('platter', 'quantity');
    steps.forEach((step) => phases.push({ kind: 'item-step', step: step.step }));
    phases.push('decoration', 'details', 'review');
    return phases;
  }, [menus.length, steps]);

  const safePhaseIndex = Math.min(phaseIndex, Math.max(0, flow.length - 1));
  const phase: FlowPhase | undefined = flow[safePhaseIndex];

  const platterType: PlatterType | null = useMemo(() => {
    if (!selectedMenu || !platterTypeId) return null;
    return selectedMenu.platterTypes.find((row) => row.id === platterTypeId) || null;
  }, [selectedMenu, platterTypeId]);

  const itemById = useMemo(() => {
    const map = new Map<string, PartyMenuItem>();
    menuItems.forEach((item) => map.set(item.firebaseId, item));
    return map;
  }, [menuItems]);

  const selectedLineItems: PartyPriceLineItem[] = useMemo(() => {
    const rows: PartyPriceLineItem[] = [];
    Object.values(selectionsByStep).forEach((itemIds) => {
      itemIds.forEach((itemId) => {
        const item = itemById.get(itemId);
        if (!item) return;
        rows.push({ itemId: item.firebaseId, name: item.name, premium: item.premium, upgradePrice: item.upgradePrice });
      });
    });
    return rows;
  }, [selectionsByStep, itemById]);

  const priceResult = useMemo(() => {
    if (!platterType) return null;
    return calculatePartyPlatterPrice({ platterType, selectedItems: selectedLineItems, quantity });
  }, [platterType, selectedLineItems, quantity]);

  const selectedDecorationPackage: DecorationPackage | null = useMemo(() => {
    if (!decorationPackageId) return null;
    return decorationPackages.find((pkg) => pkg.firebaseId === decorationPackageId) || null;
  }, [decorationPackages, decorationPackageId]);

  const decorationPrice = selectedDecorationPackage?.price || 0;
  const combinedGrandTotal = (priceResult?.grandTotal || 0) + decorationPrice;
  const couponDiscountAmount = appliedCoupon?.discountAmount || 0;
  const finalGrandTotal = Math.max(0, combinedGrandTotal - couponDiscountAmount);

  // Coupon discount is amount-dependent (percentage / min-amount rules), so if the food or
  // decoration selection changes after a coupon was applied, silently drop a coupon that no
  // longer qualifies rather than leaving a stale discount applied to a booking that wouldn't
  // actually pass validation again.
  useEffect(() => {
    if (!appliedCoupon) return;
    if (combinedGrandTotal < appliedCoupon.coupon.minBookingAmount) {
      setAppliedCoupon(null);
      showAlert('Coupon Removed', 'Your coupon no longer applies to the updated booking amount.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedGrandTotal]);

  const handleApplyCoupon = async () => {
    const normalizedCode = couponCodeInput.trim().toUpperCase();
    if (!normalizedCode) return;

    const match = coupons.find((row) => row.code === normalizedCode);
    if (!match) {
      showAlert('Invalid Coupon', 'This coupon code was not found.');
      return;
    }

    setCouponChecking(true);
    try {
      const usageCount = await getPartyCouponUsageCountForCustomer(String(authUser?.uid || ''), normalizedCode);
      const result = validatePartyCoupon(match, combinedGrandTotal, usageCount);
      if (!result.ok) {
        showAlert('Coupon Not Applicable', result.reason);
        return;
      }
      setAppliedCoupon({ coupon: result.coupon, discountAmount: result.discountAmount });
      setCouponCodeInput('');
    } catch (error) {
      console.warn('Failed to validate party coupon.', error);
      showAlert('Coupon Error', 'Could not validate this coupon right now. Please try again.');
    } finally {
      setCouponChecking(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
  };

  const goBack = useCallback(() => {
    if (safePhaseIndex === 0) {
      router.back();
      return;
    }
    setPhaseIndex((prev) => Math.max(0, prev - 1));
  }, [safePhaseIndex]);

  const goNext = useCallback(() => {
    setPhaseIndex((prev) => Math.min(flow.length - 1, prev + 1));
  }, [flow.length]);

  const toggleItemSelection = (step: PartyMenuStep, itemId: string) => {
    const current = selectionsByStep[step.step] || [];
    const alreadySelected = current.includes(itemId);

    if (!alreadySelected && step.selectionLimit > 1 && current.length >= step.selectionLimit) {
      showAlert('Selection Limit', `You can choose up to ${step.selectionLimit} items in this step. Remove one to add another.`);
      return;
    }

    setSelectionsByStep((prev) => {
      const currentList = prev[step.step] || [];

      if (currentList.includes(itemId)) {
        return { ...prev, [step.step]: currentList.filter((row) => row !== itemId) };
      }

      if (step.selectionLimit === 1) {
        return { ...prev, [step.step]: [itemId] };
      }

      if (currentList.length >= step.selectionLimit) {
        return prev;
      }

      return { ...prev, [step.step]: [...currentList, itemId] };
    });
  };

  const getValidatedCustomerDetails = (): { name: string; mobile: string } | null => {
    const trimmedName = form.name.trim();
    const digitsOnlyMobile = form.mobile.replace(/\D/g, '');
    const dateRegex = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
    const timeRegex = /^([01]?\d|2[0-3]):[0-5]\d\s?(AM|PM|am|pm)?$/;

    if (!trimmedName) {
      showAlert('Validation', 'Please enter the customer name.');
      return null;
    }
    if (digitsOnlyMobile.length !== 10) {
      showAlert('Validation', 'Please enter a valid 10-digit mobile number.');
      return null;
    }
    if (!dateRegex.test(form.eventDate.trim())) {
      showAlert('Validation', 'Please enter the event date in DD/MM/YYYY format.');
      return null;
    }
    if (!timeRegex.test(form.eventTime.trim())) {
      showAlert('Validation', 'Please enter the event time (e.g. 07:00 PM).');
      return null;
    }
    if (!form.address.trim()) {
      showAlert('Validation', 'Please enter the event address.');
      return null;
    }

    return { name: trimmedName, mobile: digitsOnlyMobile };
  };

  const handleSubmitBooking = async () => {
    if (!selectedMenu || !platterType || !priceResult) return;

    const validated = getValidatedCustomerDetails();
    if (!validated) return;
    const { name: trimmedName, mobile: digitsOnlyMobile } = validated;

    const selectedItems: PartySelectedItem[] = priceResult.items.map((row) => {
      const item = itemById.get(row.itemId);
      return {
        itemId: row.itemId,
        step: item?.step ?? 0,
        stepLabel: item?.stepLabel ?? '',
        category: item?.category ?? '',
        name: row.name,
        portion: item?.portion || null,
        premium: row.premium,
        upgradePrice: row.upgradePrice,
        chargedUpgradePrice: row.chargedUpgradePrice,
        isFreeUpgrade: row.isFreeUpgrade,
      };
    });

    setSubmitting(true);
    try {
      // Re-validate the applied coupon right before creating the booking, in case its
      // rules or the customer's usage count changed since it was applied on this screen.
      let finalCouponApplied: AppliedPartyCoupon | null = null;
      let finalDiscountAmount = 0;
      if (appliedCoupon) {
        const usageCount = await getPartyCouponUsageCountForCustomer(String(authUser?.uid || ''), appliedCoupon.coupon.code);
        const revalidated = validatePartyCoupon(appliedCoupon.coupon, combinedGrandTotal, usageCount);
        if (!revalidated.ok) {
          showAlert('Coupon No Longer Valid', revalidated.reason);
          setAppliedCoupon(null);
          setSubmitting(false);
          return;
        }
        finalDiscountAmount = revalidated.discountAmount;
        finalCouponApplied = {
          code: revalidated.coupon.code,
          discountType: revalidated.coupon.discountType,
          discountValue: revalidated.coupon.discountValue,
          discountAmount: revalidated.discountAmount,
        };
      }

      await createPartyBooking({
        customerId: String(authUser?.uid || ''),
        partyMenuId: selectedMenu.firebaseId,
        partyMenuName: selectedMenu.name,
        platterType: platterType.id,
        platterTypeName: platterType.name,
        quantity: priceResult.quantity,
        selectedItems,
        perPersonPrice: priceResult.perPersonPrice,
        subtotal: priceResult.grandTotal,
        decorationPackage: selectedDecorationPackage
          ? { id: selectedDecorationPackage.firebaseId, name: selectedDecorationPackage.name, price: selectedDecorationPackage.price }
          : null,
        decorationPrice,
        couponApplied: finalCouponApplied,
        grandTotal: Math.max(0, combinedGrandTotal - finalDiscountAmount),
        eventDate: form.eventDate.trim(),
        eventTime: form.eventTime.trim(),
        customerDetails: {
          name: trimmedName,
          mobile: digitsOnlyMobile,
          address: form.address.trim(),
          occasion: form.occasion,
          specialInstructions: form.specialInstructions.trim() || null,
        },
      });
      setBookingComplete(true);
    } catch (error) {
      console.warn('Failed to create party booking.', error);
      showAlert('Booking Failed', 'Something went wrong while submitting your booking. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Container style={{ paddingTop: insets.top }}>
        <Center>
          <ActivityIndicator size="large" color={PartyColors.gold} />
        </Center>
      </Container>
    );
  }

  if (menus.length === 0) {
    return (
      <Container style={{ paddingTop: insets.top }}>
        <TopBar>
          <BackButton onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={PartyColors.white} />
          </BackButton>
          <TopBarTitle>Party Booking</TopBarTitle>
          <TopBarSpacer />
        </TopBar>
        <Center>
          <EmptyText>No party menus are available right now. Please check back soon.</EmptyText>
        </Center>
      </Container>
    );
  }

  if (bookingComplete) {
    return (
      <Container style={{ paddingTop: insets.top }}>
        <Center>
          <Ionicons name="checkmark-circle" size={72} color={PartyColors.gold} />
          <SuccessTitle>Booking Request Sent!</SuccessTitle>
          <SuccessSubtitle>
            Our team will reach out to you shortly to confirm your {selectedMenu?.name} booking.
          </SuccessSubtitle>
          <PrimaryButton onPress={() => router.back()} style={{ marginTop: 28, width: '80%' }}>
            <PrimaryButtonText>Done</PrimaryButtonText>
          </PrimaryButton>
        </Center>
      </Container>
    );
  }

  const showFooterSummary = phase !== 'menu-select' && phase !== 'platter' && Boolean(platterType) && Boolean(priceResult);

  const phaseLabel = (() => {
    if (phase === 'menu-select') return 'Choose Menu';
    if (phase === 'platter') return 'Choose Platter';
    if (phase === 'quantity') return 'Quantity';
    if (phase === 'review') return 'Review Order';
    if (phase === 'decoration') return 'Decoration';
    if (phase === 'details') return 'Customer Details';
    if (phase && isItemStepPhase(phase)) {
      return steps.find((row) => row.step === phase.step)?.label || `Step ${phase.step}`;
    }
    return '';
  })();

  const progressPercent = flow.length > 0 ? ((safePhaseIndex + 1) / flow.length) * 100 : 0;
  const reservedFooterHeight = showFooterSummary ? footerHeight || 150 : 0;

  return (
    <Container style={{ paddingTop: insets.top }}>
      <TopBar>
        <BackButton onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={PartyColors.white} />
        </BackButton>
        <TopBarTitle numberOfLines={1}>{selectedMenu?.name || 'Party Booking'}</TopBarTitle>
        <TopBarSpacer />
      </TopBar>

      <StepperWrap>
        <StepperTextRow>
          <StepperStepText>STEP {safePhaseIndex + 1} OF {flow.length}</StepperStepText>
          <StepperPhaseText numberOfLines={1}>{phaseLabel}</StepperPhaseText>
        </StepperTextRow>
        <ProgressTrack>
          <ProgressFill style={{ width: `${progressPercent}%` }} />
        </ProgressTrack>
      </StepperWrap>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 18, paddingBottom: reservedFooterHeight + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {phase === 'menu-select' && (
            <MenuSelectPhaseView
              menus={menus}
              onSelect={(menu) => {
                setSelectedMenu(menu);
                setPlatterTypeId(null);
                setSelectionsByStep({});
                goNext();
              }}
            />
          )}

          {phase === 'platter' && selectedMenu && (
            <PlatterPhaseView
              menu={selectedMenu}
              selectedId={platterTypeId}
              onSelect={setPlatterTypeId}
            />
          )}

          {phase === 'quantity' && platterType && (
            <QuantityPhaseView platterType={platterType} quantity={quantity} onChange={setQuantity} />
          )}

          {phase && isItemStepPhase(phase) && (
            <ItemStepPhaseView
              step={steps.find((row) => row.step === phase.step) || null}
              selectedIds={selectionsByStep[phase.step] || []}
              loading={itemsLoading}
              onToggle={toggleItemSelection}
            />
          )}

          {phase === 'review' && selectedMenu && platterType && priceResult && (
            <ReviewPhaseView
              menu={selectedMenu}
              platterType={platterType}
              quantity={quantity}
              priceResult={priceResult}
              selectedDecorationPackage={selectedDecorationPackage}
              decorationPrice={decorationPrice}
              couponCodeInput={couponCodeInput}
              onChangeCouponCodeInput={setCouponCodeInput}
              appliedCoupon={appliedCoupon}
              couponChecking={couponChecking}
              onApplyCoupon={handleApplyCoupon}
              onRemoveCoupon={handleRemoveCoupon}
              finalGrandTotal={finalGrandTotal}
            />
          )}

          {phase === 'decoration' && (
            <DecorationPhaseView
              packages={decorationPackages}
              loading={decorationLoading}
              selectedId={decorationPackageId}
              onSelect={setDecorationPackageId}
            />
          )}

          {phase === 'details' && (
            <DetailsPhaseView form={form} onChange={setForm} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {showFooterSummary && priceResult && (
        <Footer
          style={{ paddingBottom: Math.max(16, insets.bottom) }}
          onLayout={(event: LayoutChangeEvent) => setFooterHeight(event.nativeEvent.layout.height)}
        >
          <FooterSummary>
            <FooterLabel>Per Person</FooterLabel>
            <FooterValue>₹{priceResult.perPersonPrice.toFixed(0)}</FooterValue>
          </FooterSummary>
          {appliedCoupon && (
            <FooterSummary>
              <FooterLabel>Coupon ({appliedCoupon.coupon.code})</FooterLabel>
              <FooterValue>-₹{couponDiscountAmount.toFixed(0)}</FooterValue>
            </FooterSummary>
          )}
          <FooterDivider />
          <FooterSummary>
            <FooterLabel>Grand Total</FooterLabel>
            <FooterValueLarge>₹{finalGrandTotal.toFixed(0)}</FooterValueLarge>
          </FooterSummary>
          <PrimaryButton
            disabled={submitting}
            onPress={() => {
              if (phase === 'review') {
                void handleSubmitBooking();
                return;
              }

              if (phase === 'details') {
                if (!getValidatedCustomerDetails()) return;
                goNext();
                return;
              }

              if (phase && isItemStepPhase(phase)) {
                const step = steps.find((row) => row.step === phase.step);
                const selectedCount = (selectionsByStep[phase.step] || []).length;
                if (step && selectedCount !== step.selectionLimit) {
                  showAlert('Selection Required', `Please choose ${step.selectionLimit} item${step.selectionLimit > 1 ? 's' : ''} to continue.`);
                  return;
                }
              }

              goNext();
            }}
          >
            {submitting ? (
              <ActivityIndicator color={PartyColors.black} />
            ) : (
              <PrimaryButtonText>{phase === 'review' ? 'Book Now' : 'Continue'}</PrimaryButtonText>
            )}
          </PrimaryButton>
        </Footer>
      )}

      {!showFooterSummary && (
        <BottomActionBar style={{ paddingBottom: Math.max(16, insets.bottom) }}>
          <PrimaryButton
            disabled={phase === 'platter' && !platterTypeId}
            onPress={goNext}
          >
            <PrimaryButtonText>Continue</PrimaryButtonText>
          </PrimaryButton>
        </BottomActionBar>
      )}
    </Container>
  );
}

function MenuSelectPhaseView({ menus, onSelect }: { menus: PartyMenu[]; onSelect: (menu: PartyMenu) => void }) {
  return (
    <>
      <PhaseTitle>Choose a Party Menu</PhaseTitle>
      <PhaseSubtitle>Pick the menu you would like to build your party platter from.</PhaseSubtitle>
      {menus.map((menu) => (
        <MenuOptionCard key={menu.firebaseId} activeOpacity={0.88} onPress={() => onSelect(menu)}>
          <MenuOptionTitle>{menu.name}</MenuOptionTitle>
          {menu.description ? <MenuOptionDescription>{menu.description}</MenuOptionDescription> : null}
        </MenuOptionCard>
      ))}
    </>
  );
}

function PlatterPhaseView({
  menu,
  selectedId,
  onSelect,
}: {
  menu: PartyMenu;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <PhaseTitle>Choose Your Platter</PhaseTitle>
      <PhaseSubtitle>Select the platter tier that fits your event.</PhaseSubtitle>
      {menu.platterTypes.map((platter) => {
        const isSelected = platter.id === selectedId;
        return (
          <PlatterCard key={platter.id} $selected={isSelected} activeOpacity={0.88} onPress={() => onSelect(platter.id)}>
            <PlatterImage source={imageSourceOrLogo(platter.image)} resizeMode="cover" />
            <PlatterCardBody>
              <PlatterCardHeader>
                <PlatterCardName $selected={isSelected}>{platter.name}</PlatterCardName>
                <PlatterCardPrice $selected={isSelected}>₹{platter.price}</PlatterCardPrice>
              </PlatterCardHeader>
              {platter.description ? <PlatterCardDescription>{platter.description}</PlatterCardDescription> : null}
              <PlatterCardPerk>
                {platter.unlimitedPremiumItems
                  ? 'All premium upgrades included'
                  : platter.freePremiumUpgrades > 0
                    ? `${platter.freePremiumUpgrades} free premium upgrade${platter.freePremiumUpgrades > 1 ? 's' : ''}`
                    : 'No free premium upgrades'}
              </PlatterCardPerk>
            </PlatterCardBody>
            {isSelected && <SelectedCheck><Ionicons name="checkmark-circle" size={22} color={PartyColors.gold} /></SelectedCheck>}
          </PlatterCard>
        );
      })}
    </>
  );
}

function QuantityPhaseView({
  platterType,
  quantity,
  onChange,
}: {
  platterType: PlatterType;
  quantity: number;
  onChange: (value: number) => void;
}) {
  return (
    <>
      <PhaseTitle>How Many Platters?</PhaseTitle>
      <PhaseSubtitle>Set the number of platters for your event.</PhaseSubtitle>
      <QuantityCard>
        <QuantityStepperRow>
          <QuantityButton onPress={() => onChange(Math.max(1, quantity - 1))}>
            <QuantityButtonText>-</QuantityButtonText>
          </QuantityButton>
          <QuantityValue>{quantity}</QuantityValue>
          <QuantityButton onPress={() => onChange(quantity + 1)}>
            <QuantityButtonText>+</QuantityButtonText>
          </QuantityButton>
        </QuantityStepperRow>
        <QuantityFormula>₹{platterType.price} x {quantity} = ₹{platterType.price * quantity}</QuantityFormula>
      </QuantityCard>
    </>
  );
}

function ItemStepPhaseView({
  step,
  selectedIds,
  loading,
  onToggle,
}: {
  step: PartyMenuStep | null;
  selectedIds: string[];
  loading: boolean;
  onToggle: (step: PartyMenuStep, itemId: string) => void;
}) {
  if (loading) {
    return (
      <Center style={{ paddingTop: 60 }}>
        <ActivityIndicator size="large" color={PartyColors.gold} />
      </Center>
    );
  }

  if (!step) {
    return (
      <Center style={{ paddingTop: 60 }}>
        <EmptyText>No items configured for this step yet.</EmptyText>
      </Center>
    );
  }

  return (
    <>
      <PhaseTitle>{step.label}</PhaseTitle>
      <PhaseSubtitle>
        Choose {step.selectionLimit} item{step.selectionLimit > 1 ? 's' : ''} · {selectedIds.length}/{step.selectionLimit} selected
      </PhaseSubtitle>

      {step.categories.map((categoryGroup) => (
        <CategoryBlock key={categoryGroup.category}>
          {step.categories.length > 1 && <CategoryHeading>{categoryGroup.category}</CategoryHeading>}
          {categoryGroup.items.map((item) => {
            const isSelected = selectedIds.includes(item.firebaseId);
            return (
              <ItemCard key={item.firebaseId} $selected={isSelected} activeOpacity={0.88} onPress={() => onToggle(step, item.firebaseId)}>
                <ItemImage source={imageSourceOrLogo(item.image)} resizeMode="cover" />
                <ItemCardMain>
                  <ItemCardTop>
                    <ItemCardName $selected={isSelected}>{item.name}</ItemCardName>
                    {item.premium && <PremiumBadge><PremiumBadgeText>PREMIUM</PremiumBadgeText></PremiumBadge>}
                  </ItemCardTop>
                  {item.portion ? <ItemCardPortion>{item.portion}</ItemCardPortion> : null}
                  {item.premium && item.upgradePrice > 0 ? (
                    <ItemCardUpgrade>+₹{item.upgradePrice} upgrade</ItemCardUpgrade>
                  ) : null}
                </ItemCardMain>
                <SelectionIndicator $selected={isSelected}>
                  {isSelected && <Ionicons name="checkmark" size={16} color={PartyColors.black} />}
                </SelectionIndicator>
              </ItemCard>
            );
          })}
        </CategoryBlock>
      ))}
    </>
  );
}

function ReviewPhaseView({
  menu,
  platterType,
  quantity,
  priceResult,
  selectedDecorationPackage,
  decorationPrice,
  couponCodeInput,
  onChangeCouponCodeInput,
  appliedCoupon,
  couponChecking,
  onApplyCoupon,
  onRemoveCoupon,
  finalGrandTotal,
}: {
  menu: PartyMenu;
  platterType: PlatterType;
  quantity: number;
  priceResult: ReturnType<typeof calculatePartyPlatterPrice>;
  selectedDecorationPackage: DecorationPackage | null;
  decorationPrice: number;
  couponCodeInput: string;
  onChangeCouponCodeInput: (value: string) => void;
  appliedCoupon: { coupon: PartyCoupon; discountAmount: number } | null;
  couponChecking: boolean;
  onApplyCoupon: () => void;
  onRemoveCoupon: () => void;
  finalGrandTotal: number;
}) {
  return (
    <>
      <PhaseTitle>Review Your Order</PhaseTitle>
      <PhaseSubtitle>{menu.name} · {platterType.name} Platter</PhaseSubtitle>

      <ReviewSectionLabel>Selected Food</ReviewSectionLabel>
      <ReviewCard>
        {priceResult.items.map((item) => (
          <ReviewRow key={item.itemId}>
            <ReviewRowLeft>
              <ReviewItemName>{item.name}</ReviewItemName>
              {item.premium && (
                <ReviewItemTag $free={item.isFreeUpgrade}>
                  {item.isFreeUpgrade ? 'FREE UPGRADE' : `+₹${item.chargedUpgradePrice}`}
                </ReviewItemTag>
              )}
            </ReviewRowLeft>
          </ReviewRow>
        ))}
      </ReviewCard>

      <ReviewSectionLabel>Decoration Package</ReviewSectionLabel>
      <ReviewCard>
        <ReviewRow>
          <ReviewRowLeft>
            <ReviewItemName>{selectedDecorationPackage ? selectedDecorationPackage.name : 'No Decoration'}</ReviewItemName>
          </ReviewRowLeft>
          <ReviewItemName>₹{decorationPrice.toFixed(0)}</ReviewItemName>
        </ReviewRow>
      </ReviewCard>

      <ReviewSectionLabel>Coupon</ReviewSectionLabel>
      <ReviewCard>
        {appliedCoupon ? (
          <CouponAppliedRow>
            <CouponAppliedInfo>
              <CouponAppliedCode>{appliedCoupon.coupon.code}</CouponAppliedCode>
              <CouponAppliedText>
                {appliedCoupon.coupon.discountType === 'percentage'
                  ? `${appliedCoupon.coupon.discountValue}% OFF`
                  : `₹${appliedCoupon.coupon.discountValue} OFF`} · You saved ₹{appliedCoupon.discountAmount.toFixed(0)}
              </CouponAppliedText>
            </CouponAppliedInfo>
            <CouponRemoveButton onPress={onRemoveCoupon}>
              <CouponRemoveText>Remove</CouponRemoveText>
            </CouponRemoveButton>
          </CouponAppliedRow>
        ) : (
          <CouponInputRow>
            <CouponInput
              value={couponCodeInput}
              onChangeText={onChangeCouponCodeInput}
              placeholder="Enter coupon code"
              placeholderTextColor={PartyColors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!couponChecking}
            />
            <CouponApplyButton
              onPress={onApplyCoupon}
              disabled={couponChecking || !couponCodeInput.trim()}
            >
              {couponChecking ? (
                <ActivityIndicator size="small" color={PartyColors.black} />
              ) : (
                <CouponApplyText>Apply</CouponApplyText>
              )}
            </CouponApplyButton>
          </CouponInputRow>
        )}
      </ReviewCard>

      <ReviewSectionLabel>Price Summary</ReviewSectionLabel>
      <ReviewCard>
        <ReviewSummaryRow>
          <ReviewSummaryLabel>Party Platter</ReviewSummaryLabel>
          <ReviewSummaryValue>{menu.name} · {platterType.name}</ReviewSummaryValue>
        </ReviewSummaryRow>
        <ReviewSummaryRow>
          <ReviewSummaryLabel>Guests</ReviewSummaryLabel>
          <ReviewSummaryValue>x {quantity}</ReviewSummaryValue>
        </ReviewSummaryRow>
        <ReviewSummaryRow>
          <ReviewSummaryLabel>Per Person Price</ReviewSummaryLabel>
          <ReviewSummaryValue>₹{priceResult.perPersonPrice.toFixed(0)}</ReviewSummaryValue>
        </ReviewSummaryRow>
        <ReviewSummaryRow>
          <ReviewSummaryLabel>Food Subtotal</ReviewSummaryLabel>
          <ReviewSummaryValue>₹{priceResult.grandTotal.toFixed(0)}</ReviewSummaryValue>
        </ReviewSummaryRow>
        <ReviewSummaryRow>
          <ReviewSummaryLabel>Decoration Price</ReviewSummaryLabel>
          <ReviewSummaryValue>₹{decorationPrice.toFixed(0)}</ReviewSummaryValue>
        </ReviewSummaryRow>
        {appliedCoupon && (
          <ReviewSummaryRow>
            <ReviewSummaryLabel>Coupon Discount ({appliedCoupon.coupon.code})</ReviewSummaryLabel>
            <ReviewSummaryValue>-₹{appliedCoupon.discountAmount.toFixed(0)}</ReviewSummaryValue>
          </ReviewSummaryRow>
        )}
        <ReviewDivider />
        <ReviewSummaryRow>
          <ReviewSummaryLabelLarge>Grand Total</ReviewSummaryLabelLarge>
          <ReviewSummaryValueLarge>₹{finalGrandTotal.toFixed(0)}</ReviewSummaryValueLarge>
        </ReviewSummaryRow>
      </ReviewCard>
    </>
  );
}

const buildDecorationGalleryImages = (pkg: DecorationPackage): ImageSource[] => {
  const urls = [pkg.coverImage, ...(pkg.gallery || [])].filter((row): row is string => Boolean(row && row.trim()));
  if (urls.length === 0) return [FALLBACK_LOGO as ImageSource];
  return urls.map((uri) => ({ uri }));
};

function DecorationPhaseView({
  packages,
  loading,
  selectedId,
  onSelect,
}: {
  packages: DecorationPackage[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [viewerImages, setViewerImages] = useState<ImageSource[]>([]);
  const [viewerVisible, setViewerVisible] = useState(false);

  const openViewer = (pkg: DecorationPackage) => {
    setViewerImages(buildDecorationGalleryImages(pkg));
    setViewerVisible(true);
  };

  if (loading) {
    return (
      <Center style={{ paddingTop: 60 }}>
        <ActivityIndicator size="large" color={PartyColors.gold} />
      </Center>
    );
  }

  return (
    <>
      <PhaseTitle>Choose Decoration Package</PhaseTitle>
      <PhaseSubtitle>Make your celebration even more memorable.</PhaseSubtitle>

      <DecorationCard $selected={selectedId === null} activeOpacity={0.88} onPress={() => onSelect(null)}>
        <DecorationCardHeader>
          <DecorationCardName $selected={selectedId === null}>No Decoration</DecorationCardName>
          <DecorationCardPrice $selected={selectedId === null}>₹0</DecorationCardPrice>
        </DecorationCardHeader>
        <DecorationCardDescription>Skip decoration for this booking.</DecorationCardDescription>
        {selectedId === null && (
          <SelectedCheck>
            <Ionicons name="checkmark-circle" size={22} color={PartyColors.gold} />
          </SelectedCheck>
        )}
      </DecorationCard>

      {packages.length === 0 ? (
        <EmptyText>No decoration packages are available right now.</EmptyText>
      ) : (
        packages.map((pkg) => {
          const isSelected = pkg.firebaseId === selectedId;
          return (
            <DecorationCard key={pkg.firebaseId} $selected={isSelected} activeOpacity={0.88} onPress={() => onSelect(pkg.firebaseId)}>
              <DecorationImageButton activeOpacity={0.85} onPress={() => openViewer(pkg)}>
                <DecorationImage source={imageSourceOrLogo(pkg.coverImage)} resizeMode="cover" />
                <DecorationImageZoomHint>
                  <Ionicons name="expand-outline" size={14} color={PartyColors.white} />
                </DecorationImageZoomHint>
              </DecorationImageButton>
              {pkg.recommended && (
                <RecommendedBadge>
                  <RecommendedBadgeText>MOST POPULAR</RecommendedBadgeText>
                </RecommendedBadge>
              )}
              <DecorationCardHeader>
                <DecorationCardName $selected={isSelected}>{pkg.name}</DecorationCardName>
                <DecorationCardPrice $selected={isSelected}>₹{pkg.price}</DecorationCardPrice>
              </DecorationCardHeader>
              {pkg.description ? <DecorationCardDescription>{pkg.description}</DecorationCardDescription> : null}
              {pkg.includes.length > 0 && (
                <DecorationIncludesList>
                  {pkg.includes.map((line, index) => (
                    <DecorationIncludeRow key={`${pkg.firebaseId}-${index}`}>
                      <Ionicons name="checkmark" size={14} color={PartyColors.gold} />
                      <DecorationIncludeText>{line}</DecorationIncludeText>
                    </DecorationIncludeRow>
                  ))}
                </DecorationIncludesList>
              )}
              {isSelected && (
                <SelectedCheck>
                  <Ionicons name="checkmark-circle" size={22} color={PartyColors.gold} />
                </SelectedCheck>
              )}
            </DecorationCard>
          );
        })
      )}

      <ImageView
        images={viewerImages}
        imageIndex={0}
        visible={viewerVisible}
        onRequestClose={() => setViewerVisible(false)}
        swipeToCloseEnabled
        doubleTapToZoomEnabled
      />
    </>
  );
}

function DetailsPhaseView({ form, onChange }: { form: CustomerForm; onChange: (updater: (prev: CustomerForm) => CustomerForm) => void }) {
  const setField = (field: keyof CustomerForm, value: string) => onChange((prev) => ({ ...prev, [field]: value }));

  return (
    <>
      <PhaseTitle>Customer Details</PhaseTitle>
      <PhaseSubtitle>Tell us where and when to deliver your celebration.</PhaseSubtitle>

      <FieldLabel>Customer Name</FieldLabel>
      <FormInput value={form.name} onChangeText={(value: string) => setField('name', value)} placeholder="Full name" placeholderTextColor={PartyColors.muted} />

      <FieldLabel>Mobile Number</FieldLabel>
      <FormInput value={form.mobile} onChangeText={(value: string) => setField('mobile', value)} placeholder="10-digit mobile number" placeholderTextColor={PartyColors.muted} keyboardType="phone-pad" maxLength={10} />

      <FieldRow>
        <FieldHalf>
          <FieldLabel>Event Date</FieldLabel>
          <FormInput value={form.eventDate} onChangeText={(value: string) => setField('eventDate', value)} placeholder="DD/MM/YYYY" placeholderTextColor={PartyColors.muted} keyboardType="numbers-and-punctuation" maxLength={10} />
        </FieldHalf>
        <FieldHalf>
          <FieldLabel>Event Time</FieldLabel>
          <FormInput value={form.eventTime} onChangeText={(value: string) => setField('eventTime', value)} placeholder="07:00 PM" placeholderTextColor={PartyColors.muted} maxLength={8} />
        </FieldHalf>
      </FieldRow>

      <FieldLabel>Address</FieldLabel>
      <FormTextArea value={form.address} onChangeText={(value: string) => setField('address', value)} placeholder="Event address" placeholderTextColor={PartyColors.muted} multiline numberOfLines={3} />

      <FieldLabel>Occasion</FieldLabel>
      <OccasionRow>
        {PARTY_BOOKING_OCCASIONS.map((occasion) => {
          const isSelected = form.occasion === occasion;
          return (
            <OccasionChip key={occasion} $selected={isSelected} onPress={() => setField('occasion', occasion)}>
              <OccasionChipText $selected={isSelected}>{occasion}</OccasionChipText>
            </OccasionChip>
          );
        })}
      </OccasionRow>

      <FieldLabel>Special Instructions</FieldLabel>
      <FormTextArea
        value={form.specialInstructions}
        onChangeText={(value: string) => setField('specialInstructions', value)}
        placeholder="Anything else we should know?"
        placeholderTextColor={PartyColors.muted}
        multiline
        numberOfLines={3}
      />
    </>
  );
}

const Container = styled.SafeAreaView`
  flex: 1;
  background-color: ${PartyColors.black};
`;

const Center = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const TopBar = styled.View`
  flex-direction: row;
  align-items: center;
  padding: 14px 16px;
  border-bottom-width: 1px;
  border-bottom-color: ${PartyColors.border};
`;

const BackButton = styled(TouchableOpacity)`
  width: 38px;
  height: 38px;
  border-radius: 19px;
  align-items: center;
  justify-content: center;
  background-color: ${PartyColors.surface};
`;

const TopBarTitle = styled.Text`
  flex: 1;
  text-align: center;
  color: ${PartyColors.white};
  font-size: 17px;
  font-weight: 800;
  margin: 0 8px;
`;

const TopBarSpacer = styled.View`
  width: 38px;
`;

const StepperWrap = styled.View`
  padding: 14px 18px 12px;
  border-bottom-width: 1px;
  border-bottom-color: ${PartyColors.border};
`;

const StepperTextRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;

const StepperStepText = styled.Text`
  color: ${PartyColors.goldLight};
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
`;

const StepperPhaseText = styled.Text`
  color: ${PartyColors.muted};
  font-size: 12px;
  font-weight: 700;
  margin-left: 12px;
  flex-shrink: 1;
  text-align: right;
`;

const ProgressTrack = styled.View`
  height: 6px;
  border-radius: 3px;
  background-color: ${PartyColors.surface};
  overflow: hidden;
`;

const ProgressFill = styled.View`
  height: 100%;
  border-radius: 3px;
  background-color: ${PartyColors.gold};
`;

const PhaseTitle = styled.Text`
  color: ${PartyColors.white};
  font-size: 22px;
  font-weight: 800;
  margin-bottom: 6px;
`;

const PhaseSubtitle = styled.Text`
  color: ${PartyColors.muted};
  font-size: 14px;
  margin-bottom: 18px;
`;

const EmptyText = styled.Text`
  color: ${PartyColors.muted};
  font-size: 14px;
  text-align: center;
`;

const SuccessTitle = styled.Text`
  color: ${PartyColors.white};
  font-size: 22px;
  font-weight: 800;
  margin-top: 16px;
`;

const SuccessSubtitle = styled.Text`
  color: ${PartyColors.muted};
  font-size: 14px;
  text-align: center;
  margin-top: 8px;
  line-height: 20px;
`;

const MenuOptionCard = styled(TouchableOpacity)`
  background-color: ${PartyColors.surface};
  border-radius: 16px;
  padding: 18px;
  margin-bottom: 12px;
  border-width: 1px;
  border-color: ${PartyColors.border};
`;

const MenuOptionTitle = styled.Text`
  color: ${PartyColors.white};
  font-size: 17px;
  font-weight: 800;
`;

const MenuOptionDescription = styled.Text`
  color: ${PartyColors.muted};
  font-size: 13px;
  margin-top: 6px;
`;

const PlatterCard = styled(TouchableOpacity)<{ $selected: boolean }>`
  flex-direction: row;
  background-color: ${PartyColors.surface};
  border-radius: 16px;
  padding: 18px;
  margin-bottom: 14px;
  border-width: ${(props: { $selected: boolean }) => (props.$selected ? '2px' : '1px')};
  border-color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.border)};
`;

const PlatterImage = styled.Image`
  width: 56px;
  height: 56px;
  border-radius: 12px;
  margin-right: 14px;
  background-color: ${PartyColors.surfaceAlt};
`;

const PlatterCardBody = styled.View`
  flex: 1;
`;

const PlatterCardHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding-right: 26px;
`;

const PlatterCardName = styled.Text<{ $selected: boolean }>`
  font-size: 18px;
  font-weight: 800;
  color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.white)};
`;

const PlatterCardPrice = styled.Text<{ $selected: boolean }>`
  font-size: 18px;
  font-weight: 800;
  color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.white)};
`;

const PlatterCardDescription = styled.Text`
  color: ${PartyColors.muted};
  font-size: 13px;
  margin-top: 8px;
`;

const PlatterCardPerk = styled.Text`
  color: ${PartyColors.goldLight};
  font-size: 12px;
  font-weight: 600;
  margin-top: 10px;
`;

const SelectedCheck = styled.View`
  position: absolute;
  top: 14px;
  right: 14px;
`;

const DecorationCard = styled(TouchableOpacity)<{ $selected: boolean }>`
  background-color: ${PartyColors.surface};
  border-radius: 16px;
  padding: 18px;
  margin-bottom: 14px;
  border-width: ${(props: { $selected: boolean }) => (props.$selected ? '2px' : '1px')};
  border-color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.border)};
`;

const DecorationImageButton = styled(TouchableOpacity)`
  margin-bottom: 12px;
`;

const DecorationImage = styled.Image`
  width: 100%;
  height: 110px;
  border-radius: 12px;
  background-color: ${PartyColors.surfaceAlt};
`;

const DecorationImageZoomHint = styled.View`
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  border-radius: 13px;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.55);
`;

const DecorationCardHeader = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding-right: 30px;
`;

const DecorationCardName = styled.Text<{ $selected: boolean }>`
  font-size: 17px;
  font-weight: 800;
  color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.white)};
`;

const DecorationCardPrice = styled.Text<{ $selected: boolean }>`
  font-size: 17px;
  font-weight: 800;
  color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.white)};
`;

const DecorationCardDescription = styled.Text`
  color: ${PartyColors.muted};
  font-size: 13px;
  margin-top: 8px;
`;

const DecorationIncludesList = styled.View`
  margin-top: 12px;
`;

const DecorationIncludeRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
`;

const DecorationIncludeText = styled.Text`
  color: ${PartyColors.offWhite};
  font-size: 13px;
  flex-shrink: 1;
`;

const RecommendedBadge = styled.View`
  position: absolute;
  top: -1px;
  right: 18px;
  background-color: ${PartyColors.gold};
  padding: 4px 10px;
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
`;

const RecommendedBadgeText = styled.Text`
  color: ${PartyColors.black};
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.5px;
`;

const QuantityCard = styled.View`
  background-color: ${PartyColors.surface};
  border-radius: 16px;
  padding: 24px;
  align-items: center;
  border-width: 1px;
  border-color: ${PartyColors.border};
`;

const QuantityStepperRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 24px;
`;

const QuantityButton = styled(TouchableOpacity)`
  width: 44px;
  height: 44px;
  border-radius: 22px;
  align-items: center;
  justify-content: center;
  background-color: ${PartyColors.gold};
`;

const QuantityButtonText = styled.Text`
  font-size: 22px;
  font-weight: 800;
  color: ${PartyColors.black};
`;

const QuantityValue = styled.Text`
  font-size: 30px;
  font-weight: 800;
  color: ${PartyColors.white};
  min-width: 60px;
  text-align: center;
`;

const QuantityFormula = styled.Text`
  color: ${PartyColors.muted};
  font-size: 14px;
  margin-top: 18px;
`;

const CategoryBlock = styled.View`
  margin-bottom: 8px;
`;

const CategoryHeading = styled.Text`
  color: ${PartyColors.goldLight};
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
  margin-top: 6px;
  text-transform: uppercase;
`;

const ItemCard = styled(TouchableOpacity)<{ $selected: boolean }>`
  flex-direction: row;
  align-items: center;
  background-color: ${PartyColors.surface};
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 10px;
  border-width: ${(props: { $selected: boolean }) => (props.$selected ? '2px' : '1px')};
  border-color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.border)};
`;

const ItemImage = styled.Image`
  width: 48px;
  height: 48px;
  border-radius: 10px;
  margin-right: 12px;
  background-color: ${PartyColors.surfaceAlt};
`;

const ItemCardMain = styled.View`
  flex: 1;
`;

const ItemCardTop = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
`;

const ItemCardName = styled.Text<{ $selected: boolean }>`
  font-size: 15px;
  font-weight: 700;
  color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.white)};
`;

const ItemCardPortion = styled.Text`
  color: ${PartyColors.muted};
  font-size: 12px;
  margin-top: 4px;
`;

const ItemCardUpgrade = styled.Text`
  color: ${PartyColors.warning};
  font-size: 12px;
  font-weight: 700;
  margin-top: 4px;
`;

const PremiumBadge = styled.View`
  background-color: ${PartyColors.goldDark};
  border-radius: 6px;
  padding: 2px 6px;
`;

const PremiumBadgeText = styled.Text`
  color: ${PartyColors.black};
  font-size: 9px;
  font-weight: 800;
`;

const SelectionIndicator = styled.View<{ $selected: boolean }>`
  width: 26px;
  height: 26px;
  border-radius: 13px;
  align-items: center;
  justify-content: center;
  background-color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : 'transparent')};
  border-width: 2px;
  border-color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.border)};
`;

const ReviewSectionLabel = styled.Text`
  color: ${PartyColors.goldLight};
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
`;

const ReviewCard = styled.View`
  background-color: ${PartyColors.surface};
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 14px;
  border-width: 1px;
  border-color: ${PartyColors.border};
`;

const ReviewRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
`;

const ReviewRowLeft = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  flex: 1;
`;

const ReviewItemName = styled.Text`
  color: ${PartyColors.white};
  font-size: 14px;
  font-weight: 600;
`;

const ReviewItemTag = styled.Text<{ $free: boolean }>`
  font-size: 10px;
  font-weight: 800;
  color: ${(props: { $free: boolean }) => (props.$free ? PartyColors.success : PartyColors.warning)};
`;

const ReviewSummaryRow = styled.View`
  flex-direction: row;
  justify-content: space-between;
  padding: 6px 0;
`;

const ReviewSummaryLabel = styled.Text`
  color: ${PartyColors.muted};
  font-size: 13px;
`;

const ReviewSummaryValue = styled.Text`
  color: ${PartyColors.white};
  font-size: 13px;
  font-weight: 700;
`;

const ReviewSummaryLabelLarge = styled.Text`
  color: ${PartyColors.gold};
  font-size: 16px;
  font-weight: 800;
`;

const ReviewSummaryValueLarge = styled.Text`
  color: ${PartyColors.gold};
  font-size: 18px;
  font-weight: 800;
`;

const ReviewDivider = styled.View`
  height: 1px;
  background-color: ${PartyColors.border};
  margin: 8px 0;
`;

const CouponInputRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
`;

const CouponInput = styled.TextInput`
  flex: 1;
  border-width: 1px;
  border-color: ${PartyColors.border};
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: ${PartyColors.white};
`;

const CouponApplyButton = styled(TouchableOpacity).attrs({ activeOpacity: 0.85 })<{ disabled?: boolean }>`
  background-color: ${PartyColors.gold};
  border-radius: 10px;
  padding: 12px 18px;
  align-items: center;
  justify-content: center;
  opacity: ${(props: { disabled?: boolean }) => (props.disabled ? 0.5 : 1)};
`;

const CouponApplyText = styled.Text`
  color: ${PartyColors.black};
  font-size: 14px;
  font-weight: 800;
`;

const CouponAppliedRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

const CouponAppliedInfo = styled.View`
  flex: 1;
`;

const CouponAppliedCode = styled.Text`
  color: ${PartyColors.gold};
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.5px;
`;

const CouponAppliedText = styled.Text`
  color: ${PartyColors.success};
  font-size: 12px;
  font-weight: 600;
  margin-top: 2px;
`;

const CouponRemoveButton = styled(TouchableOpacity).attrs({ activeOpacity: 0.85 })`
  padding: 8px 12px;
`;

const CouponRemoveText = styled.Text`
  color: ${PartyColors.danger};
  font-size: 13px;
  font-weight: 700;
`;

const FieldLabel = styled.Text`
  color: ${PartyColors.muted};
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 6px;
  margin-top: 12px;
`;

const FormInput = styled.TextInput`
  background-color: ${PartyColors.surface};
  border-width: 1px;
  border-color: ${PartyColors.border};
  border-radius: 10px;
  padding: 13px 14px;
  font-size: 15px;
  color: ${PartyColors.white};
`;

const FormTextArea = styled(FormInput).attrs({ textAlignVertical: 'top' })`
  min-height: 80px;
`;

const FieldRow = styled.View`
  flex-direction: row;
  gap: 12px;
`;

const FieldHalf = styled.View`
  flex: 1;
`;

const OccasionRow = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
`;

const OccasionChip = styled(TouchableOpacity)<{ $selected: boolean }>`
  padding: 9px 14px;
  border-radius: 20px;
  background-color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.surface)};
  border-width: 1px;
  border-color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.gold : PartyColors.border)};
`;

const OccasionChipText = styled.Text<{ $selected: boolean }>`
  color: ${(props: { $selected: boolean }) => (props.$selected ? PartyColors.black : PartyColors.white)};
  font-size: 13px;
  font-weight: 700;
`;

const Footer = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: ${PartyColors.charcoal};
  border-top-width: 1px;
  border-top-color: ${PartyColors.border};
  padding: 14px 18px;
`;

const FooterSummary = styled.View`
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

const FooterLabel = styled.Text`
  color: ${PartyColors.muted};
  font-size: 12px;
`;

const FooterValue = styled.Text`
  color: ${PartyColors.white};
  font-size: 14px;
  font-weight: 700;
`;

const FooterValueLarge = styled.Text`
  color: ${PartyColors.gold};
  font-size: 20px;
  font-weight: 800;
`;

const FooterDivider = styled.View`
  height: 1px;
  background-color: ${PartyColors.border};
  margin: 8px 0;
`;

const BottomActionBar = styled.View`
  padding: 14px 18px;
`;

const PrimaryButton = styled(TouchableOpacity).attrs({ activeOpacity: 0.88 })`
  margin-top: 12px;
  background-color: ${PartyColors.gold};
  border-radius: 14px;
  padding: 15px;
  align-items: center;
  justify-content: center;
  opacity: ${(props: { disabled?: boolean }) => (props.disabled ? 0.5 : 1)};
`;

const PrimaryButtonText = styled.Text`
  color: ${PartyColors.black};
  font-size: 16px;
  font-weight: 800;
`;
