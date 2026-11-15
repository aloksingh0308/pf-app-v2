import { PRIMARY_BUTTON_GUTTER, PRIMARY_BUTTON_STYLE, PRIMARY_BUTTON_TEXT_STYLE } from '@/components/common/AppButton';
import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useIsFocused } from '@react-navigation/native';
import { router } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, GestureResponderEvent, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeInDown,
  Layout,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useDispatch, useSelector } from "react-redux";
import AddressModalMapPicker from '../../components/AddressModalMapPicker';
import styled from 'styled-components/native';
import AddAddressModal, { type AddressLabel } from '../../components/AddAddressModal';
import { T } from '../../constants/tokens';
import { useAppLoader } from '../../hooks/useAppLoader';
import { addressService, UserAddress } from '../../services/addressService';
import { showAlert } from '../../services/alertService';
import { DEFAULT_LOCATION_MAX_AGE_MS, getFreshCachedUserLocation, warmupUserLocationCache } from '../../services/locationCacheService';
import { getBranchTableList } from '../../services/orderService';
import { findRestaurantByAnyId } from '../../services/restaurantService';
import { setActiveRestaurant } from '../../services/restaurantContext';
import { subscribeToServiceAvailability, ServiceAvailability } from '../../services/appConfigService';
import { AppDispatch, RootState } from '../../store';
import { OrderType } from '../../types/enums';
import { extractCoordinates, getDistanceInKm } from '../../utils/locationUtils';

const DEFAULT_MAP_CENTER = {
  latitude: 25.4358,
  longitude: 81.8463,
};

const TABLES_CACHE_TTL_MS = 30000;
const MAX_DELIVERY_DISTANCE_KM = 5;
const ADDRESS_MENU_WIDTH = 200;

const AnimatedTableCell = memo(function AnimatedTableCell({
  item,
  selected,
  onSelect,
  index,
}: {
  item: { label: string; value: string; occupied: boolean };
  selected: boolean;
  onSelect: (value: string) => void;
  index: number;
}) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // No `entering` mount animation here (deliberately removed) — all 8 of these cells
  // unmount in the same render pass whenever `orderType` flips away from DINE_IN, at the
  // exact moment a different animated section (HomeDeliveryAddressSection) mounts in its
  // place. That simultaneous mass Reanimated-view teardown + a new `entering` animation
  // starting is a known Reanimated/Fabric (New Architecture) race: Reanimated's UI-thread
  // animation driver can still be updating a view's props after Fabric has already torn
  // the surface down for it, which crashes with "Unable to find viewState for tag N" —
  // 100% reproducible on this exact screen transition. The press-feedback scale animation
  // below is untouched (user-triggered, not a mount/unmount race).
  return (
    // Exactly a third of the row with the gutter inside the wrapper (TableGrid cancels the
    // outer gutter with a negative margin) — cells always span the full width, 3 per row.
    <Animated.View style={[{ width: '33.333%', paddingHorizontal: 5, marginBottom: 10 }, animatedStyle]}>
      <TableCell
        accessibilityRole="radio"
        accessibilityLabel={`${item.label}, ${item.occupied ? 'reserved' : selected ? 'selected' : 'available'}`}
        accessibilityState={{ selected, disabled: item.occupied }}
        $selected={selected}
        $reserved={item.occupied}
        disabled={item.occupied}
        activeOpacity={0.8}
        onPress={() => {
          if (item.occupied) return;
          scale.value = withSequence(
            withSpring(0.93, { damping: 14, stiffness: 240 }),
            withSpring(1, { damping: 14, stiffness: 200 }),
          );
          onSelect(item.value);
        }}
      >
        {selected ? (
          <CornerCheck>
            <Ionicons name="checkmark" size={11} color="#fff" />
          </CornerCheck>
        ) : null}
        <TableIcon>
          <TableIconSvg
            color={item.occupied ? T.color.faint : selected ? T.color.brand : T.color.inkSoft}
          />
        </TableIcon>
        <TableLabel $selected={selected} $reserved={item.occupied} numberOfLines={1}>
          {item.label}
        </TableLabel>
        <TableStatus $reserved={item.occupied}>
          {item.occupied ? 'Reserved' : selected ? 'Your table' : 'Available'}
        </TableStatus>
      </TableCell>
    </Animated.View>
  );
});

const DineInTableSection = memo(function DineInTableSection({
  showSkeleton,
  tableData,
  tableNumber,
  onSelectTable,
}: {
  showSkeleton: boolean;
  tableData: { label: string; value: string; occupied: boolean }[];
  tableNumber: string;
  onSelectTable: (value: string) => void;
}) {
  const freeCount = tableData.filter((table) => !table.occupied).length;
  return (
    <View>
      <Section>
        <SectionHeaderRow>
          <SectionHeader>Choose your table</SectionHeader>
          {!showSkeleton && tableData.length > 0 ? <SectionHint>{freeCount} of {tableData.length} free</SectionHint> : null}
        </SectionHeaderRow>
        <SectionSubtitle>Pick the table you’re seated at.</SectionSubtitle>
        {showSkeleton ? (
          <TableGrid>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={{ width: '33.333%', paddingHorizontal: 5, marginBottom: 10 }}>
                <TableSkeletonCell />
              </View>
            ))}
          </TableGrid>
        ) : tableData.length === 0 ? (
          <EmptyStateCard>
            <EmptyStateIcon>
              <Ionicons name="grid-outline" size={22} color={T.color.brand} />
            </EmptyStateIcon>
            <EmptyStateTitle>No tables listed yet</EmptyStateTitle>
            <EmptyStateText>Please ask the staff to help you place your order.</EmptyStateText>
          </EmptyStateCard>
        ) : (
          <TableGrid>
            {tableData.map((item, index) => (
              <AnimatedTableCell
                key={item.value}
                item={item}
                selected={tableNumber === item.value}
                onSelect={onSelectTable}
                index={index}
              />
            ))}
          </TableGrid>
        )}
        <InfoNote>
          <Ionicons name="information-circle-outline" size={16} color={T.color.muted} />
          <InfoNoteText>Can’t find your table? Ask the staff for help.</InfoNoteText>
        </InfoNote>
      </Section>
    </View>
  );
});

const ADDRESS_LABEL_ICONS: Record<string, 'home-outline' | 'briefcase-outline' | 'location-outline'> = {
  Home: 'home-outline',
  Work: 'briefcase-outline',
};

const HomeDeliveryAddressSection = memo(function HomeDeliveryAddressSection({
  loadingAddresses,
  savedAddresses,
  selectedAddressId,
  settingDefaultAddressId,
  deletingAddressId,
  onOpenAddNewAddress,
  onSelectSavedAddress,
  onSetDefaultAddress,
  onEditAddress,
  onDeleteAddress,
  addressDistanceKm,
}: {
  addressDistanceKm: Record<string, number | null>;
  loadingAddresses: boolean;
  savedAddresses: UserAddress[];
  selectedAddressId: string;
  settingDefaultAddressId: string;
  deletingAddressId: string;
  onOpenAddNewAddress: () => void;
  onSelectSavedAddress: (address: UserAddress) => void;
  onSetDefaultAddress: (addressId: string) => void;
  onEditAddress: (address: UserAddress) => void;
  onDeleteAddress: (addressId: string) => void;
}) {
  const window = useWindowDimensions();
  // ⋮ menu for one address, anchored to where it was tapped (full-screen coordinates).
  const [menu, setMenu] = useState<{ address: UserAddress; top: number; left: number } | null>(null);
  const openMenu = (address: UserAddress, event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent;
    const menuHeight = address.isDefault ? 104 : 152;
    const left = Math.max(12, Math.min(pageX - ADDRESS_MENU_WIDTH + 16, window.width - ADDRESS_MENU_WIDTH - 12));
    const below = pageY + 14;
    const top = below + menuHeight > window.height - 24 ? pageY - menuHeight - 14 : below;
    setMenu({ address, top, left });
  };
  const runMenuAction = (action: (address: UserAddress) => void) => {
    const target = menu?.address;
    setMenu(null);
    if (target) action(target);
  };

  // No `entering` mount animation on the outer wrapper (deliberately removed) — this
  // mounts in the same render pass as DineInTableSection's 8 cells unmounting; see the
  // matching note on AnimatedTableCell above for why that combination crashes Fabric.
  return (
    <View>
      <Modal visible={Boolean(menu)} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMenu(null)}>
        <Pressable style={{ flex: 1 }} onPress={() => setMenu(null)} accessibilityLabel="Close menu">
          {menu ? (
            <AddressMenu style={[{ top: menu.top, left: menu.left, width: ADDRESS_MENU_WIDTH }, T.shadow.float]}>
              {!menu.address.isDefault ? (
                <AddressMenuItem accessibilityRole="button" onPress={() => runMenuAction((address) => onSetDefaultAddress(address.id))}>
                  <Ionicons name="star-outline" size={18} color={T.color.inkSoft} />
                  <AddressMenuText>Set as default</AddressMenuText>
                </AddressMenuItem>
              ) : null}
              <AddressMenuItem accessibilityRole="button" onPress={() => runMenuAction(onEditAddress)}>
                <Ionicons name="create-outline" size={18} color={T.color.inkSoft} />
                <AddressMenuText>Edit address</AddressMenuText>
              </AddressMenuItem>
              <AddressMenuItem accessibilityRole="button" $last onPress={() => runMenuAction((address) => onDeleteAddress(address.id))}>
                <Ionicons name="trash-outline" size={18} color={T.color.danger} />
                <AddressMenuText $danger>Delete address</AddressMenuText>
              </AddressMenuItem>
            </AddressMenu>
          ) : null}
        </Pressable>
      </Modal>
      <Section>
        <SectionHeaderRow>
          <SectionHeader>Deliver to</SectionHeader>
          {savedAddresses.length > 0 ? (
            <AddNewAddressInlineButton onPress={onOpenAddNewAddress} activeOpacity={0.8} accessibilityRole="button">
              <Ionicons name="add" size={16} color={T.color.brand} />
              <AddNewAddressInlineText>Add new</AddNewAddressInlineText>
            </AddNewAddressInlineButton>
          ) : null}
        </SectionHeaderRow>
        {loadingAddresses && savedAddresses.length === 0 ? (
          <>
            <AddressSkeletonCard />
            <AddressSkeletonCard />
          </>
        ) : savedAddresses.length > 0 ? (
          savedAddresses.map((address, addrIndex) => {
            const selected = selectedAddressId === address.id;
            const label = address.label || 'Saved address';
            return (
              <Animated.View
                key={address.id}
                entering={FadeInDown.delay(addrIndex * 70).springify().damping(16)}
                layout={Layout.springify()}
              >
                <SavedAddressCard
                  activeOpacity={0.8}
                  $selected={selected}
                  accessibilityRole="radio"
                  accessibilityLabel={`${label}, ${address.addressLine}`}
                  accessibilityState={{ selected }}
                  onPress={() => onSelectSavedAddress(address)}
                >
                  <SavedAddressMainRow>
                    <AddressIconCircle $selected={selected}>
                      <Ionicons
                        name={ADDRESS_LABEL_ICONS[String(address.label)] || 'location-outline'}
                        size={18}
                        color={selected ? T.color.brand : T.color.inkSoft}
                      />
                    </AddressIconCircle>
                    <View style={{ flex: 1 }}>
                      <SavedHeaderGroup>
                        <SavedAddressLabel>{label}</SavedAddressLabel>
                        {address.isDefault ? (
                          <DefaultBadge>
                            <DefaultBadgeText>DEFAULT</DefaultBadgeText>
                          </DefaultBadge>
                        ) : null}
                      </SavedHeaderGroup>
                      <SavedAddressText numberOfLines={2}>{address.addressLine}</SavedAddressText>
                      {addressDistanceKm[address.id] != null ? (
                        <DistanceRow>
                          <Ionicons
                            name={Number(addressDistanceKm[address.id]) > MAX_DELIVERY_DISTANCE_KM ? 'alert-circle-outline' : 'navigate-outline'}
                            size={12}
                            color={Number(addressDistanceKm[address.id]) > MAX_DELIVERY_DISTANCE_KM ? T.color.danger : T.color.muted}
                          />
                          <DistanceText $far={Number(addressDistanceKm[address.id]) > MAX_DELIVERY_DISTANCE_KM}>
                            {Number(addressDistanceKm[address.id]) > MAX_DELIVERY_DISTANCE_KM
                              ? `${Number(addressDistanceKm[address.id]).toFixed(1)} km away · outside delivery area`
                              : `${Number(addressDistanceKm[address.id]).toFixed(1)} km from the restaurant`}
                          </DistanceText>
                        </DistanceRow>
                      ) : null}
                    </View>
                    <Ionicons
                      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={selected ? T.color.brand : '#d6d3d1'}
                    />
                    {settingDefaultAddressId === address.id || deletingAddressId === address.id ? (
                      <MoreButton as={View}>
                        <ActivityIndicator size="small" color={T.color.muted} />
                      </MoreButton>
                    ) : (
                      <MoreButton
                        accessibilityRole="button"
                        accessibilityLabel={`More options for ${label}`}
                        hitSlop={8}
                        onPress={(event: GestureResponderEvent) => openMenu(address, event)}
                      >
                        <Ionicons name="ellipsis-vertical" size={18} color={T.color.inkSoft} />
                      </MoreButton>
                    )}
                  </SavedAddressMainRow>
                </SavedAddressCard>
              </Animated.View>
            );
          })
        ) : (
          <EmptyAddressButton activeOpacity={0.8} onPress={onOpenAddNewAddress} accessibilityRole="button">
            <EmptyStateIcon>
              <Ionicons name="location-outline" size={22} color={T.color.brand} />
            </EmptyStateIcon>
            <EmptyStateTitle>Where should we deliver?</EmptyStateTitle>
            <EmptyStateText>Add an address and pin it on the map so the rider finds you easily.</EmptyStateText>
            <EmptyStateCta>
              <Ionicons name="add" size={16} color="#fff" />
              <EmptyStateCtaText>Add address</EmptyStateCtaText>
            </EmptyStateCta>
          </EmptyAddressButton>
        )}
      </Section>
    </View>
  );
});

const ORDER_TYPE_OPTIONS = [
  { type: OrderType.DINE_IN, title: 'Dine In', desc: 'Eat at the restaurant', icon: 'restaurant-outline' },
  { type: OrderType.TAKE_AWAY, title: 'Take-Away', desc: 'Pick it up yourself', icon: 'bag-handle-outline' },
  { type: OrderType.HOME_DELIVERY, title: 'Delivery', desc: 'To your doorstep', icon: 'bicycle-outline' },
] as const;


// ─── Main Screen ──────────────────────────────────────────────────────────────
const OrderTypeLocationScreen = () => {
  // Balanced-accuracy GPS fixes (what the app uses everywhere for speed — see
  // locationCacheService) routinely drift 100-500m indoors or in a dense area, so a customer
  // standing at the actual cafe could easily compute as > 500m away and get silently forced
  // into Home Delivery. This only needs to answer "are they plausibly near enough to dine
  // in," not draw a precise geofence, so it's set generously above typical GPS error.
  const NEAR_CAFE_DISTANCE_METERS = 1500;
  const GOOGLE_MAPS_API_KEY = String(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
  const loadedTablesRestaurantRef = useRef('');
  const lastTablesFetchAtRef = useRef(0);
  const tableNumberRef = useRef('');
  const hasLoadedTablesRef = useRef(false);
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const dispatch = useDispatch<AppDispatch>();
  const authUser = useSelector((state: RootState) => state.auth.user);
  const cartItems = useSelector((state: RootState) => state.cart.items);
  const cartState = useSelector((state: RootState) => state.cart);
  const cachedLocationState = useSelector((state: RootState) => state.location);
  const [orderType, setOrderType] = useState<OrderType>(OrderType.DINE_IN);
  const [tableNumber, setTableNumber] = useState<string>(String(cartState.editingTableNumber || ''));
  const [deliveryAddress, setDeliveryAddress] = useState(String(cartState.editingDeliveryAddress || ''));
  const [deliveryAddressDetails, setDeliveryAddressDetails] = useState("");
  const [deliveryPin, setDeliveryPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loadingDeliveryMap, setLoadingDeliveryMap] = useState(false);
  const [isAddressModalVisible, setIsAddressModalVisible] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<UserAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState(String(cartState.editingDeliveryAddressId || ''));
  // True once the customer taps an address (or is editing an order that already has one) —
  // after that the nearest-address auto-pick below leaves their choice alone.
  const userChoseAddressRef = useRef(Boolean(cartState.editingDeliveryAddressId));
  const [editingAddressId, setEditingAddressId] = useState('');
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [isContinueBusy, setIsContinueBusy] = useState(false);
  const appLoader = useAppLoader();
  const [savingAddress, setSavingAddress] = useState(false);
  const [deletingAddressId, setDeletingAddressId] = useState('');
  const [settingDefaultAddressId, setSettingDefaultAddressId] = useState('');
  const [selectedAddressLabel, setSelectedAddressLabel] = useState<AddressLabel>('Home');
  const [branchTables, setBranchTables] = useState<{ name: string; occupied: boolean }[]>([]);
  const [restaurantCoords, setRestaurantCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isNearCafe, setIsNearCafe] = useState<boolean | null>(null);
  const [serviceAvailability, setServiceAvailability] = useState<ServiceAvailability>({
    dineIn: { available: true, message: '' },
    takeaway: { available: true, message: '' },
    homeDelivery: { available: true, message: '' },
  });
  const resolvedRestaurantId = useMemo(() => String(
    (cartItems[0] as any)?.cafeId ||
    (cartItems[0] as any)?.restaurantId ||
    ''
  ).trim(), [cartItems]);

  useEffect(() => {
    if (cartState.editingOrderType) {
      setOrderType(String(cartState.editingOrderType) as OrderType);
    }
  }, [cartState.editingOrderType]);

  useEffect(() => {
    loadedTablesRestaurantRef.current = '';
    lastTablesFetchAtRef.current = 0;
  }, [resolvedRestaurantId]);

  // Which restaurant the table-list/dine-in-order/service-availability calls below should
  // hit — resolved from the cart's own cafeId, same as everywhere else this screen already
  // keys off it. Service-availability polling is only started AFTER setActiveRestaurant
  // resolves (not as a separate, independently-racing effect) — otherwise its very first
  // fetch fires against whatever restaurant was previously active (or the build-time
  // default) instead of this one, and only self-corrects on its next 30s poll.
  useEffect(() => {
    if (!resolvedRestaurantId) return;
    let cancelled = false;
    let unsubscribeServiceAvailability: (() => void) | null = null;

    findRestaurantByAnyId(resolvedRestaurantId).then((restaurant) => {
      if (cancelled) return;
      setActiveRestaurant(restaurant);
      unsubscribeServiceAvailability = subscribeToServiceAvailability((config) => {
        setServiceAvailability(config.services);
      });
    });

    return () => {
      cancelled = true;
      unsubscribeServiceAvailability?.();
    };
  }, [resolvedRestaurantId]);

  const handleSelectOrderType = (nextType: OrderType) => {
    setOrderType(nextType);
  };

  const resolveRestaurantCoordsForRange = async () => {
    if (restaurantCoords) {
      return restaurantCoords;
    }

    const fromCart = extractCoordinates(cartItems?.[0] as any);
    if (fromCart) {
      setRestaurantCoords(fromCart);
      return fromCart;
    }

    if (resolvedRestaurantId) {
      const cafe = await Promise.race([
        findRestaurantByAnyId(resolvedRestaurantId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
      ]).catch(() => null);
      const fromRestaurant = extractCoordinates(cafe);
      if (fromRestaurant) {
        setRestaurantCoords(fromRestaurant);
        return fromRestaurant;
      }
    }

    return null;
  };

  // Combined location + proximity check (controls loadingInit)
  useEffect(() => {
    if (!isFocused) {
      return;
    }

    let active = true;

    const resolveCurrentUserCoords = async () => {
      // Only trust Redux's cached coords if they're within the same freshness
      // window `warmupUserLocationCache` itself uses — otherwise this screen
      // can end up reusing a coordinate far older than what Home would fetch,
      // and the two screens silently diverge on "current location".
      const cachedTimestamp = Number(cachedLocationState.timestamp);
      const isCachedLocationFresh = Number.isFinite(cachedTimestamp)
        && Date.now() - cachedTimestamp <= DEFAULT_LOCATION_MAX_AGE_MS;

      if (
        isCachedLocationFresh
        && cachedLocationState.latitude != null
        && cachedLocationState.longitude != null
        && Number.isFinite(Number(cachedLocationState.latitude))
        && Number.isFinite(Number(cachedLocationState.longitude))
      ) {
        return {
          latitude: Number(cachedLocationState.latitude),
          longitude: Number(cachedLocationState.longitude),
        };
      }

      const warmed = await warmupUserLocationCache({
        dispatch,
        maxAgeMs: DEFAULT_LOCATION_MAX_AGE_MS,
      }).catch(() => null);

      if (warmed) {
        return {
          latitude: warmed.latitude,
          longitude: warmed.longitude,
        };
      }

      const cached = await getFreshCachedUserLocation(DEFAULT_LOCATION_MAX_AGE_MS);
      if (cached) {
        return {
          latitude: cached.latitude,
          longitude: cached.longitude,
        };
      }

      return null;
    };

    const runLocationAndProximityCheck = async () => {
      appLoader.show('Getting your location...');
      try {
        const loc = await resolveCurrentUserCoords();
        if (!active) return;
        if (!loc) {
          setIsNearCafe(false);
          if (!cartState.editingOrderType) {
            setOrderType(OrderType.HOME_DELIVERY);
          }
          return;
        }

        // Prefer coordinates already present on cart item so UX doesn't depend on a remote fetch.
        const cartCoords = extractCoordinates(cartItems?.[0] as any);
        let finalCafeCoords = cartCoords;

        if (!finalCafeCoords && resolvedRestaurantId) {
          const cafe = await Promise.race([
            findRestaurantByAnyId(resolvedRestaurantId),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
          ]).catch(() => null);
          if (!active) return;
          finalCafeCoords = extractCoordinates(cafe);
        }

        if (!finalCafeCoords) {
          setIsNearCafe(false);
          if (!cartState.editingOrderType) {
            setOrderType(OrderType.HOME_DELIVERY);
          }
          return;
        }

        const distKm = getDistanceInKm(finalCafeCoords, loc);
        const distanceMeters = Math.round(distKm * 1000);
        const isNear = distanceMeters <= NEAR_CAFE_DISTANCE_METERS;

        setRestaurantCoords(finalCafeCoords);
        setIsNearCafe(isNear);
        if (!cartState.editingOrderType) {
          setOrderType(isNear ? OrderType.DINE_IN : OrderType.HOME_DELIVERY);
        }
      } catch (error) {
        if (!active) return;
        setIsNearCafe(false);
        if (!cartState.editingOrderType) {
          setOrderType(OrderType.HOME_DELIVERY);
        }
      } finally {
        if (active) appLoader.hide();
      }
    };
    runLocationAndProximityCheck();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedRestaurantId, isFocused]);

  // Dine In / Take-Away require being near the cafe; force Home Delivery once out of range.
  useEffect(() => {
    if (isNearCafe === false && orderType !== OrderType.HOME_DELIVERY) {
      setOrderType(OrderType.HOME_DELIVERY);
    }
  }, [isNearCafe, orderType]);

  // Admin-controlled emergency service toggles, layered on top of the existing
  // geography-based eligibility (dine-in/take-away already require being near the cafe).
  const canDineIn = isNearCafe !== false && serviceAvailability.dineIn.available;
  const canTakeAway = isNearCafe !== false && serviceAvailability.takeaway.available;
  const canHomeDelivery = serviceAvailability.homeDelivery.available;
  const anyServiceAvailable = canDineIn || canTakeAway || canHomeDelivery;

  // If the currently selected order type has just become unavailable (an admin disabled
  // it, or geography ruled it out), switch to the next available one instead of leaving
  // the user on a type that can no longer be submitted. Skipped while editing an existing
  // order, whose type is already fixed by the live order itself.
  useEffect(() => {
    if (cartState.editingOrderType) return;

    const isCurrentTypeAvailable =
      (orderType === OrderType.DINE_IN && canDineIn) ||
      (orderType === OrderType.TAKE_AWAY && canTakeAway) ||
      (orderType === OrderType.HOME_DELIVERY && canHomeDelivery);

    if (isCurrentTypeAvailable) return;

    if (canDineIn) setOrderType(OrderType.DINE_IN);
    else if (canTakeAway) setOrderType(OrderType.TAKE_AWAY);
    else if (canHomeDelivery) setOrderType(OrderType.HOME_DELIVERY);
    // If none are available, leave orderType as-is — the screen shows the
    // "no service available" state instead of the order type cards.
  }, [canDineIn, canTakeAway, canHomeDelivery, orderType, cartState.editingOrderType]);

  // The branch's real floor plan — however many tables it actually has, not a fixed guess.
  const tableData = useMemo(
    () => branchTables.map((table) => ({
      label: /^\d+$/.test(table.name) ? `Table ${table.name}` : table.name,
      value: table.name,
      occupied: table.occupied,
    })),
    [branchTables]
  );

  const shouldShowTableSkeleton = useMemo(() => {
    return loadingTables
      || (
        orderType === OrderType.DINE_IN
        && loadedTablesRestaurantRef.current !== resolvedRestaurantId
        && !hasLoadedTablesRef.current
      );
  }, [loadingTables, orderType, resolvedRestaurantId, branchTables]);

  useEffect(() => {
    tableNumberRef.current = tableNumber;
  }, [tableNumber]);

  // A table only means something for dine-in — drop it as soon as the customer leaves
  // dine-in, so coming back starts with no table picked instead of a stale one.
  useEffect(() => {
    if (orderType !== OrderType.DINE_IN) setTableNumber('');
  }, [orderType]);

  const defaultMapCenter = DEFAULT_MAP_CENTER;

  const loadOccupiedTables = useCallback(async (options?: { force?: boolean }) => {
    if (!resolvedRestaurantId) {
      setBranchTables([]);
      return;
    }

    const now = Date.now();
    const hasFreshCachedTables =
      !options?.force
      && loadedTablesRestaurantRef.current === resolvedRestaurantId
      && hasLoadedTablesRef.current
      && now - lastTablesFetchAtRef.current < TABLES_CACHE_TTL_MS;

    if (hasFreshCachedTables) {
      return;
    }

    try {
      const shouldShowLoading = loadedTablesRestaurantRef.current !== resolvedRestaurantId || !hasLoadedTablesRef.current;
      if (shouldShowLoading) {
        setLoadingTables(true);
      }
      const tables = await getBranchTableList();
      setBranchTables(tables);
      loadedTablesRestaurantRef.current = resolvedRestaurantId;
      hasLoadedTablesRef.current = true;
      lastTablesFetchAtRef.current = Date.now();

      const stillExistsAndOpen = tables.find((table) => table.name === tableNumberRef.current);
      if (tableNumberRef.current && (!stillExistsAndOpen || stillExistsAndOpen.occupied)) {
        setTableNumber('');
      }
    } catch (error) {
      console.error('Failed to load branch tables:', error);
    } finally {
      setLoadingTables(false);
    }
  }, [resolvedRestaurantId]);

  const loadSavedAddresses = useCallback(async () => {
    if (!authUser?.uid) {
      setSavedAddresses([]);
      setSelectedAddressId('');
      return null;
    }

    try {
      setLoadingAddresses(true);
      const addresses = await addressService.listUserAddresses(authUser.uid);
      setSavedAddresses(addresses);
      return addresses;
    } catch (error) {
      console.error('Failed to load addresses:', error);
      return null;
    } finally {
      setLoadingAddresses(false);
    }
  }, [authUser?.uid]);

  const handleSelectSavedAddress = useCallback((address: UserAddress) => {
    setSelectedAddressId(address.id);
    setDeliveryAddress(address.addressLine || '');
    setDeliveryAddressDetails('');
    setSelectedAddressLabel(address.label === 'Work' ? 'Work' : address.label === 'Other' ? 'Other' : 'Home');

    if (address.latitude != null && address.longitude != null && Number.isFinite(Number(address.latitude)) && Number.isFinite(Number(address.longitude))) {
      const latitude = Number(address.latitude);
      const longitude = Number(address.longitude);
      setDeliveryPin({ latitude, longitude });
    }
  }, []);

  const handleMapAddressChange = useCallback((address: string) => {
    setDeliveryAddress(address);
  }, []);

  const handleMapPinChange = useCallback((pin: { latitude: number; longitude: number } | null) => {
    setDeliveryPin(pin);
  }, []);

  const handleMapLoadingChange = useCallback((loading: boolean) => {
    setLoadingDeliveryMap(loading);
  }, []);

  const buildFullDeliveryAddress = () => {
    return [deliveryAddressDetails.trim(), deliveryAddress.trim()]
      .filter(Boolean)
      .join(', ');
  };

  useEffect(() => {
    if (orderType !== OrderType.DINE_IN) {
      return;
    }

    void loadOccupiedTables();
  }, [orderType, loadOccupiedTables]);

  useEffect(() => {
    if (orderType !== OrderType.HOME_DELIVERY) {
      return;
    }

    void loadSavedAddresses();
  }, [orderType, loadSavedAddresses]);

  // Restaurant location is needed to rank saved addresses by distance, even when the
  // customer's own GPS fix (which the proximity check above relies on) isn't available.
  useEffect(() => {
    if (orderType !== OrderType.HOME_DELIVERY || restaurantCoords) return;
    void resolveRestaurantCoordsForRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderType, restaurantCoords, resolvedRestaurantId]);

  const addressDistanceKm = useMemo(() => {
    const distances: Record<string, number | null> = {};
    savedAddresses.forEach((address) => {
      const latitude = Number(address.latitude);
      const longitude = Number(address.longitude);
      distances[address.id] = restaurantCoords
        && address.latitude != null && address.longitude != null
        && Number.isFinite(latitude) && Number.isFinite(longitude)
        ? getDistanceInKm(restaurantCoords, { latitude, longitude })
        : null;
    });
    return distances;
  }, [savedAddresses, restaurantCoords]);

  // The address to pre-select for this restaurant: the nearest saved address within delivery
  // range. Falls back to the default (or first) when none are in range or the restaurant's
  // location isn't known yet.
  const preferredAddress = useMemo(() => {
    if (savedAddresses.length === 0) return null;
    const fallback = savedAddresses.find((address) => address.isDefault) || savedAddresses[0];
    const inRange = savedAddresses
      .filter((address) => {
        const distance = addressDistanceKm[address.id];
        return distance != null && distance <= MAX_DELIVERY_DISTANCE_KM;
      })
      .sort((a, b) => Number(addressDistanceKm[a.id]) - Number(addressDistanceKm[b.id]));
    if (inRange.length === 0) return fallback;
    return inRange[0];
  }, [savedAddresses, addressDistanceKm]);

  useEffect(() => {
    if (orderType !== OrderType.HOME_DELIVERY || isAddressModalVisible || !preferredAddress) {
      return;
    }

    // Never override an address the customer picked themselves.
    if (userChoseAddressRef.current && selectedAddressId) {
      return;
    }

    if (preferredAddress.id !== selectedAddressId) {
      handleSelectSavedAddress(preferredAddress);
    }
  }, [orderType, preferredAddress, selectedAddressId, isAddressModalVisible, handleSelectSavedAddress]);

  const handleUserSelectAddress = useCallback((address: UserAddress) => {
    userChoseAddressRef.current = true;
    handleSelectSavedAddress(address);
  }, [handleSelectSavedAddress]);

  const handleEditAddress = useCallback((address: UserAddress) => {
    setEditingAddressId(address.id);
    setSelectedAddressLabel(address.label === 'Work' ? 'Work' : address.label === 'Other' ? 'Other' : 'Home');
    handleSelectSavedAddress(address);
    // Split back into the map location and the house/flat field, so the flat number shows in
    // its own field instead of glued onto the map address. Older addresses only have the
    // combined line — those open with everything in the location, as before.
    const mapAddress = String(address.mapAddress || '').trim();
    if (mapAddress) {
      setDeliveryAddress(mapAddress);
      setDeliveryAddressDetails(String(address.details || ''));
    }
    setIsAddressModalVisible(true);
  }, [handleSelectSavedAddress]);

  const handleOpenAddNewAddress = useCallback(() => {
    setSelectedAddressId('');
    setEditingAddressId('');
    setDeliveryAddress('');
    setDeliveryAddressDetails('');
    setDeliveryPin(null);

    setIsAddressModalVisible(true);
  }, []);

  const handleCloseAddressModal = () => {
    // Editing split the address into its two parts; closing without saving goes back to the
    // saved address as it was.
    const edited = editingAddressId ? savedAddresses.find((address) => address.id === editingAddressId) : undefined;
    if (edited) handleSelectSavedAddress(edited);
    setEditingAddressId('');
    setIsAddressModalVisible(false);
  };

  const handleDeleteAddress = useCallback(async (addressId: string) => {
    if (!authUser?.uid) {
      showAlert('Login Required', 'Please login to manage addresses.');
      return;
    }

    showAlert(
      'Delete Address',
      'Are you sure you want to delete this address?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingAddressId(addressId);
              await addressService.deleteUserAddress(authUser.uid, addressId);

              if (selectedAddressId === addressId) {
                userChoseAddressRef.current = false;
                setSelectedAddressId('');
              }
              if (editingAddressId === addressId) {
                setEditingAddressId('');
              }

              await loadSavedAddresses();
            } catch (_) {
              showAlert('Error', 'Unable to delete address right now. Please try again.');
            } finally {
              setDeletingAddressId('');
            }
          },
        },
      ]
    );
  }, [authUser?.uid, editingAddressId, loadSavedAddresses, selectedAddressId]);

  const handleSetDefaultAddress = useCallback(async (addressId: string) => {
    if (!authUser?.uid) {
      showAlert('Login Required', 'Please login to manage addresses.');
      return;
    }

    try {
      setSettingDefaultAddressId(addressId);
      await addressService.setDefaultAddress(authUser.uid, addressId);
      const addresses = await loadSavedAddresses();
      // Select the new default for real (address text + pin), not just its id.
      const nextDefault = addresses?.find((address) => address.id === addressId);
      userChoseAddressRef.current = true;
      if (nextDefault) handleSelectSavedAddress(nextDefault);
      else setSelectedAddressId(addressId);
    } catch (_) {
      showAlert('Error', 'Unable to set default address right now. Please try again.');
    } finally {
      setSettingDefaultAddressId('');
    }
  }, [authUser?.uid, loadSavedAddresses, handleSelectSavedAddress]);

  const handleSaveAddress = async () => {
    if (!authUser?.uid) {
      showAlert('Login Required', 'Please login to save addresses.');
      return;
    }

    if (!deliveryAddress.trim()) {
      showAlert('Validation', 'Please enter delivery address before saving.');
      return;
    }

    try {
      setSavingAddress(true);
      const fullDeliveryAddress = buildFullDeliveryAddress();
      let savedAddressId = editingAddressId;
      if (editingAddressId) {
        await addressService.updateUserAddress(authUser.uid, editingAddressId, {
          addressLine: fullDeliveryAddress || deliveryAddress.trim(),
          details: deliveryAddressDetails.trim() || null,
          mapAddress: deliveryAddress.trim(),
          latitude: deliveryPin?.latitude ?? null,
          longitude: deliveryPin?.longitude ?? null,
          label: selectedAddressLabel,
        });
      } else {
        const savedId = await addressService.addUserAddress(authUser.uid, {
          addressLine: fullDeliveryAddress || deliveryAddress.trim(),
          details: deliveryAddressDetails.trim() || null,
          mapAddress: deliveryAddress.trim(),
          latitude: deliveryPin?.latitude ?? null,
          longitude: deliveryPin?.longitude ?? null,
          label: selectedAddressLabel,
        });
        userChoseAddressRef.current = true;
        setSelectedAddressId(savedId);
        savedAddressId = savedId;
      }

      // Re-select from the fresh list so the selection carries the full saved line (house
      // details + map address), not just the map part the form was editing.
      const addresses = await loadSavedAddresses();
      const savedAddress = addresses?.find((address) => address.id === savedAddressId);
      if (savedAddress) handleSelectSavedAddress(savedAddress);
      setEditingAddressId('');
      setIsAddressModalVisible(false);
      showAlert('Success', editingAddressId ? 'Address updated successfully.' : 'Address saved successfully.');
    } catch (error) {
      showAlert('Error', 'Unable to save address right now. Please try again.');
    } finally {
      setSavingAddress(false);
    }
  };

  const handleContinue = async () => {
    if (!anyServiceAvailable) {
      showAlert(
        'Ordering Unavailable',
        serviceAvailability.dineIn.message
          || serviceAvailability.takeaway.message
          || serviceAvailability.homeDelivery.message
          || 'Dine-in, take-away and home delivery are all paused right now. Please check back shortly.'
      );
      return;
    }

    const fullDeliveryAddress = buildFullDeliveryAddress();

    // Validation
    if (orderType === OrderType.DINE_IN && !tableNumber) {
      showAlert('Validation', 'Please select a table number');
      return;
    }

    if (orderType === OrderType.DINE_IN && tableNumber) {
      const latestTables = await getBranchTableList();
      setBranchTables(latestTables);

      const stillAvailable = latestTables.find((table) => table.name === tableNumber);
      if (!stillAvailable || stillAvailable.occupied) {
        setTableNumber('');
        showAlert('Table Unavailable', `Table ${tableNumber} is already in use with a current pending order. Please select another table.`);
        return;
      }
    }
    if (orderType === OrderType.HOME_DELIVERY && !deliveryAddress.trim()) {
      showAlert('Validation', 'Please enter delivery address');
      return;
    }
    if (orderType === OrderType.HOME_DELIVERY) {
      const coordsForRange = await resolveRestaurantCoordsForRange();
      if (!coordsForRange) {
        console.warn('Delivery range verification skipped: missing restaurant coordinates', {
          resolvedRestaurantId,
          hasRestaurantCoordsState: Boolean(restaurantCoords),
          hasCartItems: cartItems.length > 0,
          firstCartItemKeys: Object.keys((cartItems?.[0] as unknown as Record<string, unknown>) || {}),
        });
      } else {
        const selectedAddress = selectedAddressId
          ? savedAddresses.find((a) => a.id === selectedAddressId)
          : undefined;
        const selectedAddressCoords = selectedAddress
          && selectedAddress.latitude != null
          && selectedAddress.longitude != null
          && Number.isFinite(Number(selectedAddress.latitude))
          && Number.isFinite(Number(selectedAddress.longitude))
          ? {
            latitude: Number(selectedAddress.latitude),
            longitude: Number(selectedAddress.longitude),
          }
          : null;

        const coordsToCheck = deliveryPin || selectedAddressCoords;

        if (!coordsToCheck) {
          // Allow manual address only flow when map pin is unavailable on device.
          console.warn('Skipping delivery distance check: no map pin/saved coordinates available');
        } else {
          const distKm = getDistanceInKm(coordsForRange, coordsToCheck);
          if (distKm > MAX_DELIVERY_DISTANCE_KM) {
            showAlert('Out of Delivery Range', `Your delivery location is ${distKm.toFixed(1)}km away. We only deliver within ${MAX_DELIVERY_DISTANCE_KM}km of the cafe.`);
            return;
          }
        }
      }
    }

    const selectedAddress = selectedAddressId
      ? savedAddresses.find((a) => a.id === selectedAddressId)
      : undefined;
    const selectedAddressHasCoords = selectedAddress
      && selectedAddress.latitude != null
      && selectedAddress.longitude != null
      && Number.isFinite(Number(selectedAddress.latitude))
      && Number.isFinite(Number(selectedAddress.longitude));
    const resolvedDeliveryLatitude = orderType === OrderType.HOME_DELIVERY
      ? (deliveryPin ? String(deliveryPin.latitude) : selectedAddressHasCoords ? String(Number(selectedAddress?.latitude)) : '')
      : '';
    const resolvedDeliveryLongitude = orderType === OrderType.HOME_DELIVERY
      ? (deliveryPin ? String(deliveryPin.longitude) : selectedAddressHasCoords ? String(Number(selectedAddress?.longitude)) : '')
      : '';

    router.push({
      pathname: '/user/checkout',
      params: {
        orderType,
        tableNumber: orderType === OrderType.DINE_IN ? tableNumber : '',
        deliveryAddress: orderType === OrderType.HOME_DELIVERY ? (fullDeliveryAddress || deliveryAddress) : '',
        restaurantId: resolvedRestaurantId,
        deliveryLatitude: resolvedDeliveryLatitude,
        deliveryLongitude: resolvedDeliveryLongitude,
        deliveryAddressId: orderType === OrderType.HOME_DELIVERY ? selectedAddressId : '',
        existingOrderId: cartState.editingOrderId || '',
      }
    });
  };

  const handleContinuePress = () => {
    if (isContinueBusy) {
      return;
    }

    setIsContinueBusy(true);
    appLoader.show('Please wait...');

    requestAnimationFrame(async () => {
      try {
        await handleContinue();
      } finally {
        appLoader.hide();
        setIsContinueBusy(false);
      }
    });
  };

  const isWaitingForAutoLocation = isAddressModalVisible
    && orderType === OrderType.HOME_DELIVERY
    && !editingAddressId
    && loadingDeliveryMap
    && !deliveryAddress.trim();

  const saveAddressButtonText = isWaitingForAutoLocation
    ? 'Detecting Current Location...'
    : savingAddress
      ? 'Saving Address...'
      : editingAddressId
        ? 'Update Address'
        : 'Save Address';

  const isOrderTypeAvailable: Record<string, boolean> = {
    [OrderType.DINE_IN]: canDineIn,
    [OrderType.TAKE_AWAY]: canTakeAway,
    [OrderType.HOME_DELIVERY]: canHomeDelivery,
  };
  const availableOrderTypes = ORDER_TYPE_OPTIONS.filter((option) => isOrderTypeAvailable[option.type]);
  // A lone option reads better as a compact row than one oversized tile.
  const isSingleOrderType = availableOrderTypes.length === 1;
  // Dine-in / take-away disappear when the customer is out of range — say why instead of
  // leaving them wondering where the options went.
  const showOutOfRangeHint = isNearCafe === false
    && canHomeDelivery
    && (serviceAvailability.dineIn.available || serviceAvailability.takeaway.available);

  const selectedSavedAddress = savedAddresses.find((address) => address.id === selectedAddressId);
  const selectedTableLabel = tableData.find((table) => table.value === tableNumber)?.label || `Table ${tableNumber}`;
  const footerSummary: { icon: 'restaurant-outline' | 'bag-handle-outline' | 'location-outline'; title: string; subtitle: string; missing: boolean } =
    orderType === OrderType.DINE_IN
      ? tableNumber
        ? { icon: 'restaurant-outline', title: selectedTableLabel, subtitle: 'Dine in · served at your table', missing: false }
        : { icon: 'restaurant-outline', title: 'No table selected', subtitle: 'Pick your table above', missing: true }
      : orderType === OrderType.TAKE_AWAY
        ? { icon: 'bag-handle-outline', title: 'Pickup from the restaurant', subtitle: 'Collect it at the counter', missing: false }
        : deliveryAddress.trim()
          ? { icon: 'location-outline', title: `Delivering to ${selectedSavedAddress?.label || 'this address'}`, subtitle: deliveryAddress, missing: false }
          : { icon: 'location-outline', title: 'No address selected', subtitle: 'Add or pick a delivery address', missing: true };

  return (
    <Container>
      <PageHeader title="Order details" />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <JourneyHeader>
          <StepBar>
            <StepSegment $active />
            <StepSegment />
          </StepBar>
          <JourneyStep>STEP 1 OF 2</JourneyStep>
          <JourneyTitle>How would you like your order?</JourneyTitle>
          <JourneySubtitle>A table for you, a quick pickup, or your doorstep.</JourneySubtitle>
        </JourneyHeader>

        {/* Order Type Section */}
        <Section>
          {anyServiceAvailable ? (
            <>
              <OrderTypeRow accessibilityRole="radiogroup">
                {/* A service the restaurant has turned off is simply not offered — no greyed-out card. */}
                {availableOrderTypes.map((option) => {
                  const selected = orderType === option.type;
                  return (
                    <OrderTypeTile
                      key={option.type}
                      accessibilityRole="radio"
                      accessibilityLabel={`${option.title}, ${option.desc}`}
                      accessibilityState={{ selected }}
                      $selected={selected}
                      $single={isSingleOrderType}
                      activeOpacity={0.8}
                      onPress={() => handleSelectOrderType(option.type)}
                    >
                      {selected ? (
                        <CornerCheck>
                          <Ionicons name="checkmark" size={11} color="#fff" />
                        </CornerCheck>
                      ) : null}
                      <OrderTypeIconCircle $selected={selected} $single={isSingleOrderType}>
                        <Ionicons name={option.icon} size={22} color={selected ? T.color.brand : T.color.inkSoft} />
                      </OrderTypeIconCircle>
                      <View style={isSingleOrderType ? { flex: 1 } : { alignItems: 'center' }}>
                        <OrderTypeTitle $selected={selected} $single={isSingleOrderType}>{option.title}</OrderTypeTitle>
                        <OrderTypeDesc numberOfLines={2} $single={isSingleOrderType}>{option.desc}</OrderTypeDesc>
                      </View>
                    </OrderTypeTile>
                  );
                })}
              </OrderTypeRow>
              {showOutOfRangeHint ? (
                <InfoNote>
                  <Ionicons name="navigate-circle-outline" size={16} color={T.color.muted} />
                  <InfoNoteText>Dine-in and take-away show up when you’re near the restaurant.</InfoNoteText>
                </InfoNote>
              ) : null}
            </>
          ) : (
            <NoServiceCard>
              <NoServiceIcon>
                <Ionicons name="pause-circle-outline" size={28} color={T.color.danger} />
              </NoServiceIcon>
              <NoServiceTitle>Ordering is paused right now</NoServiceTitle>
              <NoServiceDesc>
                {serviceAvailability.dineIn.message
                  || serviceAvailability.takeaway.message
                  || serviceAvailability.homeDelivery.message
                  || 'Dine-in, take-away and home delivery are all paused right now. Please check back shortly — you can still browse the menu.'}
              </NoServiceDesc>
            </NoServiceCard>
          )}
        </Section>

        {anyServiceAvailable && orderType === OrderType.DINE_IN && (
          <DineInTableSection
            showSkeleton={shouldShowTableSkeleton}
            tableData={tableData}
            tableNumber={tableNumber}
            onSelectTable={setTableNumber}
          />
        )}

        {anyServiceAvailable && orderType === OrderType.TAKE_AWAY && (
          <Section>
            <SectionHeader>Pickup</SectionHeader>
            <PickupCard>
              <PickupIcon>
                <Ionicons name="bag-check-outline" size={22} color={T.color.brand} />
              </PickupIcon>
              <View style={{ flex: 1 }}>
                <PickupTitle>Freshly made for pickup</PickupTitle>
                <PickupText>Collect your order at the counter. You can track its progress from your orders.</PickupText>
              </View>
            </PickupCard>
          </Section>
        )}

        {anyServiceAvailable && orderType === OrderType.HOME_DELIVERY && (
          <HomeDeliveryAddressSection
            loadingAddresses={loadingAddresses}
            savedAddresses={savedAddresses}
            selectedAddressId={selectedAddressId}
            settingDefaultAddressId={settingDefaultAddressId}
            deletingAddressId={deletingAddressId}
            onOpenAddNewAddress={handleOpenAddNewAddress}
            onSelectSavedAddress={handleUserSelectAddress}
            addressDistanceKm={addressDistanceKm}
            onSetDefaultAddress={handleSetDefaultAddress}
            onEditAddress={handleEditAddress}
            onDeleteAddress={handleDeleteAddress}
          />
        )}
      </ScrollView>

      <AddAddressModal
        visible={isAddressModalVisible}
        editingAddressId={editingAddressId}
        insetsBottom={insets.bottom}
        deliveryAddressDetails={deliveryAddressDetails}
        selectedAddressLabel={selectedAddressLabel}
        savingAddress={savingAddress}
        disableSaveAddress={isWaitingForAutoLocation || savingAddress}
        saveAddressButtonText={saveAddressButtonText}
        pinnedAddress={deliveryAddress}
        detectingAddress={loadingDeliveryMap}
        distanceKm={deliveryPin && restaurantCoords ? getDistanceInKm(restaurantCoords, deliveryPin) : null}
        maxDeliveryKm={MAX_DELIVERY_DISTANCE_KM}
        onClose={handleCloseAddressModal}
        onDeliveryAddressDetailsChange={setDeliveryAddressDetails}
        onSelectAddressLabel={setSelectedAddressLabel}
        onSaveAddress={handleSaveAddress}
        mapPickerSection={(
          <AddressModalMapPicker
            visible={isAddressModalVisible}
            enabled={orderType === OrderType.HOME_DELIVERY}
            editingAddressId={editingAddressId}
            defaultMapCenter={defaultMapCenter}
            restaurantCoords={restaurantCoords}
            googleMapsApiKey={GOOGLE_MAPS_API_KEY}
            initialAddressText={deliveryAddress}
            initialPin={deliveryPin}
            onAddressChange={handleMapAddressChange}
            onPinChange={handleMapPinChange}
            onLoadingChange={handleMapLoadingChange}
            onClearSelectedAddress={() => setSelectedAddressId('')}
          />
        )}
      />

      <Footer style={{ paddingBottom: insets.bottom + 12 }}>
        {anyServiceAvailable ? (
          <FooterSummary>
            <FooterSummaryIcon $missing={footerSummary.missing}>
              <Ionicons name={footerSummary.icon} size={16} color={footerSummary.missing ? T.color.muted : T.color.brand} />
            </FooterSummaryIcon>
            <View style={{ flex: 1 }}>
              <FooterSummaryTitle numberOfLines={1}>{footerSummary.title}</FooterSummaryTitle>
              <FooterSummaryText numberOfLines={1}>{footerSummary.subtitle}</FooterSummaryText>
            </View>
          </FooterSummary>
        ) : null}
        <ContinueButton
          accessibilityRole="button"
          onPress={handleContinuePress}
          disabled={isContinueBusy || !anyServiceAvailable}
          style={!anyServiceAvailable ? { opacity: 0.5 } : undefined}
          activeOpacity={0.8}
        >
          <ContinueText>{isContinueBusy ? 'Please wait…' : 'Continue to checkout'}</ContinueText>
          {!isContinueBusy ? <Ionicons name="arrow-forward" size={20} color="#fff" /> : null}
        </ContinueButton>
      </Footer>
    </Container>
  );
};

export default OrderTypeLocationScreen;

type SelectedProp = { $selected: boolean };
type ReservedProp = { $reserved: boolean };
type SelectedReservedProp = { $selected: boolean; $reserved: boolean };

const Container = styled(PageScreen)`
  flex: 1;
  background-color: ${T.color.canvas};
`;

// ── Journey header ──────────────────────────────────────────────────────────
const JourneyHeader = styled.View`
  padding: 16px 16px 18px;
`;

const StepBar = styled.View`
  flex-direction: row;
  gap: 6px;
  margin-bottom: 12px;
`;

const StepSegment = styled.View<{ $active?: boolean }>`
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background-color: ${(props: { $active?: boolean }) => (props.$active ? T.color.brand : T.color.line)};
`;

const JourneyStep = styled.Text`
  color: ${T.color.brand};
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  margin-bottom: 6px;
`;

const JourneyTitle = styled.Text`
  font-size: 22px;
  font-weight: 800;
  color: ${T.color.ink};
  margin-bottom: 4px;
`;

const JourneySubtitle = styled.Text`
  color: ${T.color.muted};
  font-size: 13px;
  line-height: 19px;
`;

// ── Sections ────────────────────────────────────────────────────────────────
const Section = styled.View`
  margin: 0 16px 20px;
`;

const SectionHeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  min-height: 32px;
`;

const SectionHeader = styled.Text`
  font-size: 16px;
  font-weight: 800;
  color: ${T.color.ink};
  margin-bottom: 8px;
`;

const SectionHint = styled.Text`
  font-size: 12px;
  font-weight: 600;
  color: ${T.color.muted};
  margin-bottom: 8px;
`;

const SectionSubtitle = styled.Text`
  color: ${T.color.muted};
  font-size: 12px;
  line-height: 18px;
  margin-bottom: 10px;
`;

const InfoNote = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
`;

const InfoNoteText = styled.Text`
  flex: 1;
  color: ${T.color.muted};
  font-size: 12px;
  line-height: 17px;
`;

const CornerCheck = styled.View`
  position: absolute;
  top: 8px;
  right: 8px;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  align-items: center;
  justify-content: center;
  background-color: ${T.color.brand};
`;

// ── Order type tiles ────────────────────────────────────────────────────────
const OrderTypeRow = styled.View`
  flex-direction: row;
  gap: 10px;
  margin-bottom: 8px;
`;

type TileProp = { $selected: boolean; $single?: boolean };

const OrderTypeTile = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<TileProp>`
  flex: 1;
  flex-direction: ${(props: TileProp) => (props.$single ? 'row' : 'column')};
  min-height: ${(props: TileProp) => (props.$single ? 0 : 118)}px;
  align-items: center;
  justify-content: ${(props: TileProp) => (props.$single ? 'flex-start' : 'center')};
  padding: ${(props: TileProp) => (props.$single ? '14px 40px 14px 14px' : '14px 8px 12px')};
  border-radius: ${T.radius.lg}px;
  border-width: 1.5px;
  border-color: ${(props: TileProp) => (props.$selected ? T.color.brand : T.color.line)};
  background-color: ${(props: TileProp) => (props.$selected ? T.color.brandSoft : T.color.surface)};
`;

const OrderTypeIconCircle = styled.View<TileProp>`
  width: 44px;
  height: 44px;
  border-radius: 22px;
  align-items: center;
  justify-content: center;
  margin-bottom: ${(props: TileProp) => (props.$single ? 0 : 8)}px;
  margin-right: ${(props: TileProp) => (props.$single ? 12 : 0)}px;
  background-color: ${(props: TileProp) => (props.$selected ? '#ffffff' : T.color.canvas)};
`;

const OrderTypeTitle = styled.Text<TileProp>`
  font-size: ${(props: TileProp) => (props.$single ? 15 : 14)}px;
  font-weight: 800;
  color: ${(props: TileProp) => (props.$selected ? T.color.brand : T.color.ink)};
  text-align: ${(props: TileProp) => (props.$single ? 'left' : 'center')};
`;

const OrderTypeDesc = styled.Text<{ $single?: boolean }>`
  color: ${T.color.muted};
  font-size: ${(props: { $single?: boolean }) => (props.$single ? 12 : 11)}px;
  line-height: 15px;
  margin-top: 2px;
  text-align: ${(props: { $single?: boolean }) => (props.$single ? 'left' : 'center')};
`;

const NoServiceCard = styled.View`
  align-items: center;
  background-color: #fff5f5;
  border-width: 1px;
  border-color: #fecaca;
  border-radius: ${T.radius.lg}px;
  padding: 24px 18px;
`;

const NoServiceIcon = styled.View`
  width: 52px;
  height: 52px;
  border-radius: 26px;
  align-items: center;
  justify-content: center;
  background-color: #fee2e2;
`;

const NoServiceTitle = styled.Text`
  margin-top: 12px;
  font-size: 16px;
  font-weight: 800;
  color: ${T.color.ink};
  text-align: center;
`;

const NoServiceDesc = styled.Text`
  margin-top: 6px;
  font-size: 13px;
  color: ${T.color.muted};
  text-align: center;
  line-height: 19px;
`;

// ── Tables ──────────────────────────────────────────────────────────────────
const TableGrid = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  margin: 4px -5px 2px;
`;

const TableSkeletonCell = styled.View`
  height: 100px;
  background-color: #f1ede9;
  border-radius: ${T.radius.md}px;
`;

const TableCell = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<SelectedReservedProp>`
  width: 100%;
  min-height: 100px;
  background-color: ${(props: SelectedReservedProp) => props.$reserved ? '#f5f4f3' : props.$selected ? T.color.brandSoft : T.color.surface};
  border-width: 1.5px;
  border-color: ${(props: SelectedReservedProp) => props.$selected && !props.$reserved ? T.color.brand : T.color.line};
  border-radius: ${T.radius.md}px;
  align-items: center;
  justify-content: center;
  padding: 10px 6px;
  opacity: ${(props: SelectedReservedProp) => props.$reserved ? 0.65 : 1};
`;

const TableIcon = styled.View`
  margin-bottom: 4px;
`;

const TableLabel = styled.Text<SelectedReservedProp>`
  font-size: 12px;
  font-weight: 800;
  color: ${(props: SelectedReservedProp) => props.$reserved ? T.color.faint : props.$selected ? T.color.brand : T.color.ink};
`;

const TableStatus = styled.Text<ReservedProp>`
  font-size: 10px;
  color: ${(props: ReservedProp) => props.$reserved ? T.color.muted : T.color.success};
  margin-top: 2px;
  font-weight: 700;
`;

// ── Pickup ──────────────────────────────────────────────────────────────────
const PickupCard = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 12px;
  background-color: ${T.color.surface};
  border: 1px solid ${T.color.line};
  border-radius: ${T.radius.lg}px;
  padding: 16px;
`;

const PickupIcon = styled.View`
  width: 44px;
  height: 44px;
  border-radius: 22px;
  align-items: center;
  justify-content: center;
  background-color: ${T.color.brandSoft};
`;

const PickupTitle = styled.Text`
  font-size: 14px;
  font-weight: 800;
  color: ${T.color.ink};
  margin-bottom: 2px;
`;

const PickupText = styled.Text`
  font-size: 12px;
  line-height: 17px;
  color: ${T.color.muted};
`;

// ── Saved addresses ─────────────────────────────────────────────────────────
const AddNewAddressInlineButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  flex-direction: row;
  align-items: center;
  gap: 2px;
  padding: 6px 12px;
  margin-bottom: 8px;
  border-radius: ${T.radius.pill}px;
  background-color: ${T.color.brandSoft};
`;

const AddNewAddressInlineText = styled.Text`
  color: ${T.color.brand};
  font-size: 12px;
  font-weight: 800;
`;

const AddressSkeletonCard = styled.View`
  height: 96px;
  border-radius: ${T.radius.lg}px;
  background-color: #f1ede9;
  margin-bottom: 10px;
`;

const SavedAddressCard = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<SelectedProp>`
  border-width: 1.5px;
  border-color: ${(props: SelectedProp) => props.$selected ? T.color.brand : T.color.line};
  background-color: ${(props: SelectedProp) => props.$selected ? '#fffaf5' : T.color.surface};
  border-radius: ${T.radius.lg}px;
  padding: 14px;
  margin-bottom: 10px;
`;

const SavedAddressMainRow = styled.View`
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
`;

const AddressIconCircle = styled.View<SelectedProp>`
  width: 36px;
  height: 36px;
  border-radius: 18px;
  align-items: center;
  justify-content: center;
  background-color: ${(props: SelectedProp) => props.$selected ? T.color.brandSoft : T.color.canvas};
`;

const SavedHeaderGroup = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
`;

const SavedAddressLabel = styled.Text`
  font-size: 14px;
  color: ${T.color.ink};
  font-weight: 800;
`;

const DefaultBadge = styled.View`
  padding: 2px 6px;
  border-radius: ${T.radius.pill}px;
  background-color: ${T.color.successSoft};
`;

const DefaultBadgeText = styled.Text`
  font-size: 9px;
  letter-spacing: 0.5px;
  color: ${T.color.success};
  font-weight: 800;
`;

const SavedAddressText = styled.Text`
  font-size: 12px;
  color: ${T.color.inkSoft};
  line-height: 18px;
`;

const DistanceRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
`;

const DistanceText = styled.Text<{ $far: boolean }>`
  font-size: 11px;
  font-weight: 600;
  color: ${(props: { $far: boolean }) => (props.$far ? T.color.danger : T.color.muted)};
`;

const MoreButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  width: 32px;
  height: 32px;
  margin: -5px -8px 0 0;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
`;

const AddressMenu = styled.View`
  position: absolute;
  padding: 4px 0;
  border-radius: ${T.radius.md}px;
  border-width: 1px;
  border-color: ${T.color.line};
  background-color: ${T.color.surface};
`;

const AddressMenuItem = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })<{ $last?: boolean }>`
  flex-direction: row;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 16px;
  border-bottom-width: ${(props: { $last?: boolean }) => (props.$last ? 0 : 1)}px;
  border-bottom-color: ${T.color.line};
`;

const AddressMenuText = styled.Text<{ $danger?: boolean }>`
  font-size: 14px;
  font-weight: 600;
  color: ${(props: { $danger?: boolean }) => (props.$danger ? T.color.danger : T.color.ink)};
`;

// ── Empty states ────────────────────────────────────────────────────────────
const EmptyStateCard = styled.View`
  align-items: center;
  padding: 22px 18px;
  border-radius: ${T.radius.lg}px;
  border-width: 1px;
  border-color: ${T.color.line};
  background-color: ${T.color.surface};
  margin-bottom: 10px;
`;

const EmptyAddressButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  align-items: center;
  padding: 24px 18px;
  border-radius: ${T.radius.lg}px;
  border-width: 1.5px;
  border-style: dashed;
  border-color: ${T.color.brandBorder};
  background-color: ${T.color.surface};
`;

const EmptyStateIcon = styled.View`
  width: 48px;
  height: 48px;
  border-radius: 24px;
  align-items: center;
  justify-content: center;
  background-color: ${T.color.brandSoft};
  margin-bottom: 10px;
`;

const EmptyStateTitle = styled.Text`
  font-size: 15px;
  font-weight: 800;
  color: ${T.color.ink};
  text-align: center;
`;

const EmptyStateText = styled.Text`
  font-size: 12px;
  line-height: 18px;
  color: ${T.color.muted};
  text-align: center;
  margin-top: 4px;
`;

const EmptyStateCta = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 4px;
  margin-top: 14px;
  padding: 9px 16px;
  border-radius: ${T.radius.pill}px;
  background-color: ${T.color.brand};
`;

const EmptyStateCtaText = styled.Text`
  color: #fff;
  font-size: 13px;
  font-weight: 800;
`;

// ── Sticky footer ───────────────────────────────────────────────────────────
const Footer = styled.View`
  padding: 12px ${PRIMARY_BUTTON_GUTTER}px 0;
  background-color: ${T.color.surface};
  border-top-width: 1px;
  border-top-color: ${T.color.line};
`;

const FooterSummary = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
`;

const FooterSummaryIcon = styled.View<{ $missing: boolean }>`
  width: 32px;
  height: 32px;
  border-radius: 16px;
  align-items: center;
  justify-content: center;
  background-color: ${(props: { $missing: boolean }) => (props.$missing ? T.color.canvas : T.color.brandSoft)};
`;

const FooterSummaryTitle = styled.Text`
  font-size: 13px;
  font-weight: 800;
  color: ${T.color.ink};
`;

const FooterSummaryText = styled.Text`
  font-size: 12px;
  color: ${T.color.muted};
  margin-top: 1px;
`;

const ContinueButton = styled.TouchableOpacity.attrs({ activeOpacity: 0.8 })`
  min-height: ${PRIMARY_BUTTON_STYLE.minHeight}px;
  border-radius: ${PRIMARY_BUTTON_STYLE.borderRadius}px;
  padding: 0 ${PRIMARY_BUTTON_STYLE.paddingHorizontal}px;
  background-color: ${PRIMARY_BUTTON_STYLE.backgroundColor};
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  opacity: ${(props: any) => (props.disabled ? 0.7 : 1)};
`;

const ContinueText = styled.Text`
  color: ${PRIMARY_BUTTON_TEXT_STYLE.color};
  font-size: ${PRIMARY_BUTTON_TEXT_STYLE.fontSize}px;
  font-weight: ${PRIMARY_BUTTON_TEXT_STYLE.fontWeight};
`;

const TableIconSvg = ({ color = '#222' }: { color?: string }) => (
  <Svg width={30} height={30} viewBox="0 0 128 128" fill="none">
    <Path d="M18 28L26 64" stroke={color} strokeWidth={10} strokeLinecap="round" />
    <Path d="M26 64H42" stroke={color} strokeWidth={10} strokeLinecap="round" />
    <Path d="M26 64L16 92" stroke={color} strokeWidth={10} strokeLinecap="round" />
    <Path d="M42 64L54 92" stroke={color} strokeWidth={10} strokeLinecap="round" />
    <Path d="M44 48H84" stroke={color} strokeWidth={10} strokeLinecap="round" />
    <Path d="M64 48V92" stroke={color} strokeWidth={10} strokeLinecap="round" />
    <Path d="M56 92H72" stroke={color} strokeWidth={10} strokeLinecap="round" />
    <Path d="M110 28L102 64" stroke={color} strokeWidth={10} strokeLinecap="round" />
    <Path d="M86 64H102" stroke={color} strokeWidth={10} strokeLinecap="round" />
    <Path d="M86 64L74 92" stroke={color} strokeWidth={10} strokeLinecap="round" />
    <Path d="M102 64L112 92" stroke={color} strokeWidth={10} strokeLinecap="round" />
  </Svg>
);
