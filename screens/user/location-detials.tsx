import PageHeader, { PageScreen } from '@/components/common/PageHeader';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useIsFocused } from '@react-navigation/native';
import { router } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from 'react-native';
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
        onPress={() => {
          if (item.occupied) return;
          scale.value = withSequence(
            withSpring(0.93, { damping: 14, stiffness: 240 }),
            withSpring(1, { damping: 14, stiffness: 200 }),
          );
          onSelect(item.value);
        }}
      >
        <TableIcon>
          <TableIconSvg
            color={item.occupied ? '#bbb' : selected ? '#f68712' : '#666'}
          />
        </TableIcon>
        <TableLabel $selected={selected} $reserved={item.occupied}>
          {item.label}
        </TableLabel>
        <TableStatus $reserved={item.occupied}>
          {item.occupied ? 'Reserved' : selected ? 'Selected' : 'Available'}
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
  return (
    <View>
      <Section>
        <SectionHeader>Choose your table</SectionHeader>
        <SectionSubtitle>Select the table where you’re seated.</SectionSubtitle>
        {showSkeleton ? (
          <TableSkeletonGrid>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableSkeletonCell key={i} />
            ))}
          </TableSkeletonGrid>
        ) : (
          <TableGrid>
            {tableData.length === 0 && <SectionSubtitle>No tables available yet. Please ask our staff for help.</SectionSubtitle>}
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
        <TableInfoBox>
          <TableInfoIcon>
            <Ionicons name="information-circle" size={16} color="#f68712" />
          </TableInfoIcon>
          <TableInfoText>Can’t find your table? Ask our staff for assistance</TableInfoText>
        </TableInfoBox>
      </Section>
    </View>
  );
});

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
}: {
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
  // No `entering` mount animation on the outer wrapper (deliberately removed) — this
  // mounts in the same render pass as DineInTableSection's 8 cells unmounting; see the
  // matching note on AnimatedTableCell above for why that combination crashes Fabric.
  return (
    <View>
      <ContentContainer>
        <SavedAddressesHeaderRow>
          <SectionTitle>Deliver to</SectionTitle>
          <AddNewAddressInlineButton onPress={onOpenAddNewAddress} activeOpacity={0.8}>
            <AddNewAddressInlineText>Add New</AddNewAddressInlineText>
          </AddNewAddressInlineButton>
        </SavedAddressesHeaderRow>
        {loadingAddresses ? (
          <MetaText>Loading saved addresses...</MetaText>
        ) : savedAddresses.length > 0 ? (
          savedAddresses.map((address, addrIndex) => (
            <Animated.View
              key={address.id}
              entering={FadeInDown.delay(addrIndex * 70).springify().damping(16)}
              layout={Layout.springify()}
            >
              <SavedAddressCard
                activeOpacity={0.7}
                $selected={selectedAddressId === address.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: selectedAddressId === address.id }}
                onPress={() => onSelectSavedAddress(address)}
              >
                <SavedAddressTopRow>
                  <SavedHeaderGroup>
                    <SavedAddressLabel>{selectedAddressId === address.id ? '✓ ' : ''}{address.label || 'Saved Address'}</SavedAddressLabel>
                    {address.isDefault ? <DefaultBadgeText>Default</DefaultBadgeText> : null}
                  </SavedHeaderGroup>
                  <SavedActionsRow>
                    {!address.isDefault ? (
                      <SavedActionButton
                        activeOpacity={0.7}
                        disabled={settingDefaultAddressId === address.id}
                        onPress={() => onSetDefaultAddress(address.id)}
                      >
                        <SavedActionText>{settingDefaultAddressId === address.id ? 'Setting...' : 'Set Default'}</SavedActionText>
                      </SavedActionButton>
                    ) : null}
                    <SavedActionButton activeOpacity={0.7} onPress={() => onEditAddress(address)}>
                      <SavedActionText>Edit</SavedActionText>
                    </SavedActionButton>
                    <SavedActionButton
                      activeOpacity={0.7}
                      disabled={deletingAddressId === address.id}
                      onPress={() => onDeleteAddress(address.id)}
                    >
                      <SavedActionText>{deletingAddressId === address.id ? 'Deleting...' : 'Delete'}</SavedActionText>
                    </SavedActionButton>
                  </SavedActionsRow>
                </SavedAddressTopRow>
                <SavedAddressText numberOfLines={2}>{address.addressLine}</SavedAddressText>
              </SavedAddressCard>
            </Animated.View>
          ))
        ) : (
          <MetaText>No saved addresses yet. Add your first address below.</MetaText>
        )}
      </ContentContainer>
    </View>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
const OrderTypeLocationScreen = () => {
  // Balanced-accuracy GPS fixes (what the app uses everywhere for speed — see
  // locationCacheService) routinely drift 100-500m indoors or in a dense area, so a customer
  // standing at the actual cafe could easily compute as > 500m away and get silently forced
  // into Home Delivery. This only needs to answer "are they plausibly near enough to dine
  // in," not draw a precise geofence, so it's set generously above typical GPS error.
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
  // ── Mount animations ───────────────────────────────────────────────────────
  const btnScale = useSharedValue(1);
  const btnAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: btnScale.value }],
  }));

  // ── End animations ────────────────────────────────────────────────────────

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
        console.log("distKm",distKm)
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
      return;
    }

    try {
      setLoadingAddresses(true);
      const addresses = await addressService.listUserAddresses(authUser.uid);
      setSavedAddresses(addresses);
    } catch (error) {
      console.error('Failed to load addresses:', error);
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

  useEffect(() => {
    if (orderType !== OrderType.HOME_DELIVERY) {
      return;
    }

    if (isAddressModalVisible) {
      return;
    }

    if (selectedAddressId) {
      return;
    }

    if (savedAddresses.length > 0) {
      handleSelectSavedAddress(savedAddresses[0]);
    }
  }, [orderType, savedAddresses, selectedAddressId, isAddressModalVisible, handleSelectSavedAddress]);

  const handleEditAddress = useCallback((address: UserAddress) => {
    setEditingAddressId(address.id);
    setSelectedAddressLabel(address.label === 'Work' ? 'Work' : address.label === 'Other' ? 'Other' : 'Home');
    handleSelectSavedAddress(address);
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
      await loadSavedAddresses();
      setSelectedAddressId(addressId);
    } catch (_) {
      showAlert('Error', 'Unable to set default address right now. Please try again.');
    } finally {
      setSettingDefaultAddressId('');
    }
  }, [authUser?.uid, loadSavedAddresses]);

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
      if (editingAddressId) {
        await addressService.updateUserAddress(authUser.uid, editingAddressId, {
          addressLine: fullDeliveryAddress || deliveryAddress.trim(),
          latitude: deliveryPin?.latitude ?? null,
          longitude: deliveryPin?.longitude ?? null,
          label: selectedAddressLabel,
        });
      } else {
        const savedId = await addressService.addUserAddress(authUser.uid, {
          addressLine: fullDeliveryAddress || deliveryAddress.trim(),
          latitude: deliveryPin?.latitude ?? null,
          longitude: deliveryPin?.longitude ?? null,
          label: selectedAddressLabel,
        });
        setSelectedAddressId(savedId);
      }

      await loadSavedAddresses();
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
          if (distKm > 5) {
            showAlert('Out of Delivery Range', `Your delivery location is ${distKm.toFixed(1)}km away. We only deliver within 5km of the cafe.`);
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

  return (
    <Container>
      <PageHeader title="Delivery Details" />

      <>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 160 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <JourneyHeader>
            <JourneyStep>STEP 1 OF 2 · DELIVERY DETAILS</JourneyStep>
            <JourneyTitle>How would you like your order?</JourneyTitle>
            <SectionSubtitle>A table for you, a quick pickup, or your doorstep.</SectionSubtitle>
          </JourneyHeader>
          {/* Order Type Section */}
          <Section>
            <SectionHeader>Order type</SectionHeader>
            {anyServiceAvailable ? (
              <OrderTypeCardRow>
                {/* A service the restaurant has turned off is simply not offered — no greyed-out card. */}
                {canDineIn && (
                  <OrderTypeCard
                    accessibilityRole="radio"
                    accessibilityState={{ selected: orderType === OrderType.DINE_IN }}
                    $selected={orderType === OrderType.DINE_IN}
                    onPress={() => handleSelectOrderType(OrderType.DINE_IN)}
                  >
                    <OrderTypeIconBox $color="#f68712">
                      <Ionicons name="restaurant" size={24} color="#f68712" />
                    </OrderTypeIconBox>
                    <OrderTypeContent>
                      <OrderTypeTitleRow>
                        <OrderTypeTitle $selected={orderType === OrderType.DINE_IN}>Dine In</OrderTypeTitle>
                      </OrderTypeTitleRow>
                      <OrderTypeDesc>Enjoy your food at our cafe</OrderTypeDesc>
                    </OrderTypeContent>
                    <OrderTypeRadio $selected={orderType === OrderType.DINE_IN}>
                      {orderType === OrderType.DINE_IN && <OrderTypeRadioDot />}
                    </OrderTypeRadio>
                  </OrderTypeCard>
                )}
                {canTakeAway && (
                  <OrderTypeCard
                    accessibilityRole="radio"
                    accessibilityState={{ selected: orderType === OrderType.TAKE_AWAY }}
                    $selected={orderType === OrderType.TAKE_AWAY}
                    onPress={() => handleSelectOrderType(OrderType.TAKE_AWAY)}
                  >
                    <OrderTypeIconBox $color="#43b02a">
                      <Ionicons name="bag" size={24} color="#43b02a" />
                    </OrderTypeIconBox>
                    <OrderTypeContent>
                      <OrderTypeTitleRow>
                        <OrderTypeTitle $selected={orderType === OrderType.TAKE_AWAY}>Take-Away</OrderTypeTitle>
                      </OrderTypeTitleRow>
                      <OrderTypeDesc>Pick up your order from the cafe</OrderTypeDesc>
                    </OrderTypeContent>
                    <OrderTypeRadio $selected={orderType === OrderType.TAKE_AWAY}>
                      {orderType === OrderType.TAKE_AWAY && <OrderTypeRadioDot />}
                    </OrderTypeRadio>
                  </OrderTypeCard>
                )}
                {canHomeDelivery && (
                  <OrderTypeCard
                    accessibilityRole="radio"
                    accessibilityState={{ selected: orderType === OrderType.HOME_DELIVERY }}
                    $selected={orderType === OrderType.HOME_DELIVERY}
                    onPress={() => handleSelectOrderType(OrderType.HOME_DELIVERY)}
                  >
                    <OrderTypeIconBox $color="#7c3aed">
                      <Ionicons name="car" size={28} color="#7c3aed" />
                    </OrderTypeIconBox>
                    <OrderTypeContent>
                      <OrderTypeTitleRow>
                        <OrderTypeTitle $selected={orderType === OrderType.HOME_DELIVERY}>Home Delivery</OrderTypeTitle>
                      </OrderTypeTitleRow>
                      <OrderTypeDesc>We’ll deliver it to your doorstep</OrderTypeDesc>
                    </OrderTypeContent>
                    <OrderTypeRadio $selected={orderType === OrderType.HOME_DELIVERY}>
                      {orderType === OrderType.HOME_DELIVERY && <OrderTypeRadioDot />}
                    </OrderTypeRadio>
                  </OrderTypeCard>
                )}
              </OrderTypeCardRow>
            ) : (
              <NoServiceCard>
                <Ionicons name="alert-circle-outline" size={32} color="#e53935" />
                <NoServiceTitle>Ordering Is Temporarily Unavailable</NoServiceTitle>
                <NoServiceDesc>
                  {serviceAvailability.dineIn.message
                    || serviceAvailability.takeaway.message
                    || serviceAvailability.homeDelivery.message
                    || 'Dine-in, take-away and home delivery are all paused right now. Please check back shortly — you can still browse the menu.'}
                </NoServiceDesc>
              </NoServiceCard>
            )}
          </Section>

          {/* Table Selection Section */}
          {orderType === OrderType.DINE_IN && (
            <DineInTableSection
              showSkeleton={shouldShowTableSkeleton}
              tableData={tableData}
              tableNumber={tableNumber}
              onSelectTable={setTableNumber}
            />
          )}

          {orderType === OrderType.TAKE_AWAY && (
            <Section>
              <PickupCard>
                <Ionicons name="bag-check-outline" size={24} color="#ee7513" />
                <View style={{ flex: 1 }}>
                  <SectionHeader>Freshly made for pickup</SectionHeader>
                  <SectionSubtitle>Collect your order at the cafe. We’ll keep you updated on its progress.</SectionSubtitle>
                </View>
              </PickupCard>
            </Section>
          )}
          {/* Address and Delivery UI for Home Delivery */}
          {orderType === OrderType.HOME_DELIVERY && (
            <HomeDeliveryAddressSection
              loadingAddresses={loadingAddresses}
              savedAddresses={savedAddresses}
              selectedAddressId={selectedAddressId}
              settingDefaultAddressId={settingDefaultAddressId}
              deletingAddressId={deletingAddressId}
              onOpenAddNewAddress={handleOpenAddNewAddress}
              onSelectSavedAddress={handleSelectSavedAddress}
              onSetDefaultAddress={handleSetDefaultAddress}
              onEditAddress={handleEditAddress}
              onDeleteAddress={handleDeleteAddress}
            />
          )}
          <AddAddressModal
            visible={isAddressModalVisible}
            editingAddressId={editingAddressId}
            insetsBottom={insets.bottom}
            deliveryAddressDetails={deliveryAddressDetails}
            selectedAddressLabel={selectedAddressLabel}
            savingAddress={savingAddress}
            disableSaveAddress={isWaitingForAutoLocation || savingAddress}
            saveAddressButtonText={saveAddressButtonText}
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



          {/* Manager fields for dine-in orders */}
        </ScrollView>
        <ContinueButtonNew
          onPress={handleContinuePress}
          disabled={isContinueBusy || !anyServiceAvailable}
          style={!anyServiceAvailable ? { opacity: 0.5 } : undefined}
          // onPressIn={() => {
          //   btnScale.value = withSpring(0.95, { damping: 15, stiffness: 300 });
          // }}
          // onPressOut={() => {
          //   btnScale.value = withSpring(1, { damping: 10, stiffness: 180 });
          // }}
          $bottomInset={insets.bottom}
          activeOpacity={0.7}
        >
          <Animated.View
            style={[{ alignItems: 'center', justifyContent: 'center' }, btnAnimStyle]}
          >
            <ContinueTextNew>{isContinueBusy ? 'Please wait…' : 'Continue to checkout'}</ContinueTextNew>
          </Animated.View>
        </ContinueButtonNew>
      </>
    </Container>
  );
};

export default OrderTypeLocationScreen;


const TableSkeletonGrid = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
  margin-bottom: 18px;
`;

const TableSkeletonCell = styled.View`
  width: 31%;
  height: 104px;
  background-color: #f0f0f0;
  border-radius: 14px;
`;

const Container = styled(PageScreen)`
  flex: 1;
  background-color: #fffbf7;
`;




const ContentContainer = styled.View`
  padding: 20px;
`;

const SectionTitle = styled.Text`
  font-size: 17px;
  color: #181C2E;
  font-weight: bold;
`;

const SavedAddressesHeaderRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;

const MetaText = styled.Text`
  font-size: 13px;
  color: #b96521;
  margin-bottom: 10px;
  font-weight: 600;
`;


type SelectedProp = { $selected: boolean };
type ReservedProp = { $reserved: boolean };
type SelectedReservedProp = { $selected: boolean; $reserved: boolean };
type ColorProp = { $color: string };
type BottomInsetProp = { $bottomInset: number };

const SavedAddressCard = styled.TouchableOpacity<SelectedProp>`
  border-width: 1px;
  border-color: ${(props: SelectedProp) => props.$selected ? '#f68712' : '#ddd'};
  background-color: ${(props: SelectedProp) => props.$selected ? '#fff7ef' : '#fff'};
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 8px;
`;

const SavedAddressLabel = styled.Text`
  font-size: 13px;
  color: #f68712;
  font-weight: 700;
  margin-bottom: 4px;
`;

const SavedHeaderGroup = styled.View`
  flex-direction: row;
  align-items: center;
  column-gap: 6px;
`;

const DefaultBadgeText = styled.Text`
  font-size: 10px;
  color: #fff;
  background-color: #f68712;
  padding: 3px 6px;
  border-radius: 10px;
  overflow: hidden;
  font-weight: 700;
`;

const SavedAddressTopRow = styled.View`
  gap: 8px;
  flex-wrap: wrap;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
`;

const SavedActionsRow = styled.View`
  flex-direction: row;
  align-items: center;
  column-gap: 8px;
`;

const SavedActionButton = styled.TouchableOpacity`
  padding: 4px 8px;
  border-radius: 6px;
  background-color: #f2f2f2;
  opacity: ${(props: any) => (props.disabled ? 0.7 : 1)};
`;

const SavedActionText = styled.Text`
  font-size: 11px;
  color: #444;
  font-weight: 700;
`;

const SavedAddressText = styled.Text`
  font-size: 13px;
  color: #333;
  line-height: 18px;
`;

const AddNewAddressInlineButton = styled.TouchableOpacity`
  border-width: 1px;
  border-color: #ee7513;
  border-radius: 999px;
  min-height: 30px;
  padding: 6px 12px;
  align-items: center;
  justify-content: center;
  flex-direction: row;
  background-color: #fff;
`;

const AddNewAddressInlineText = styled.Text`
  color: #b96521;
  font-size: 12px;
  font-weight: 700;
`;



// --- Styled Components for New UI ---
const Section = styled.View`
  margin-bottom: 12px;
  margin-horizontal: 20px;
`;

const SectionHeader = styled.Text`
  font-size: 16px;
  font-weight: bold;
  color: #222;
  margin-bottom: 10px;
`;

const OrderTypeCardRow = styled.View`
  flex-direction: column;
  gap: 10px;
  margin-bottom: 8px;
`;

const OrderTypeCard = styled.TouchableOpacity<SelectedProp>`
  flex-direction: row;
  align-items: center;
  background-color: ${(props: SelectedProp) => props.$selected ? '#fff3e5' : '#fff'};
  border-width: 1px;
  border-color: ${(props: SelectedProp) => props.$selected ? '#f68712' : '#ececec'};
  border-radius: 16px;
  padding: 14px 12px;
`;

const OrderTypeIconBox = styled.View<ColorProp>`
  background-color: ${(props: ColorProp) => props.$color + '22'};
  border-radius: 12px;
  padding: 10px;
  margin-right: 14px;
`;

const OrderTypeContent = styled.View`
  flex: 1;
`;

const OrderTypeTitleRow = styled.View`
  flex-direction: row;
  align-items: center;
  margin-bottom: 2px;
`;

const OrderTypeTitle = styled.Text<SelectedProp>`
  font-size: 14px;
  font-weight: bold;
  color: ${(props: SelectedProp) => props.$selected ? '#f68712' : '#222'};
  margin-right: 8px;
`;


const OrderTypeDesc = styled.Text`
  color: #827d79;
  font-size: 12px;
  line-height: 17px;
`;

const NoServiceCard = styled.View`
  align-items: center;
  background-color: #fff5f5;
  border-width: 1px;
  border-color: #fecaca;
  border-radius: 16px;
  padding: 24px 18px;
`;

const NoServiceTitle = styled.Text`
  margin-top: 8px;
  font-size: 16px;
  font-weight: 800;
  color: #1f1f1f;
  text-align: center;
`;

const NoServiceDesc = styled.Text`
  margin-top: 6px;
  font-size: 13px;
  color: #6b7280;
  text-align: center;
  line-height: 18px;
`;

const OrderTypeRadio = styled.View<SelectedProp>`
  width: 22px;
  height: 22px;
  border-radius: 11px;
  border-width: 2px;
  border-color: ${(props: SelectedProp) => props.$selected ? '#f68712' : '#ddd'};
  align-items: center;
  justify-content: center;
  margin-left: 12px;
`;

const OrderTypeRadioDot = styled.View`
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background: #f68712;
`;

const TableGrid = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  margin: 10px -5px 8px;
`;

const TableCell = styled.TouchableOpacity<SelectedReservedProp>`
  width: 100%;
  min-height: 104px;
  background: ${(props: SelectedReservedProp) => props.$reserved ? '#f7f7f7' : props.$selected ? '#fff7ef' : '#fff'};
  border-width: 1px;
  border-color: ${(props: SelectedReservedProp) => props.$reserved ? '#ececec' : props.$selected ? '#f68712' : '#ececec'};
  border-radius: 14px;
  align-items: center;
  justify-content: center;
  padding: 10px;
  opacity: ${(props: SelectedReservedProp) => props.$reserved ? 0.7 : 1};
`;

const TableIcon = styled.View`
  margin-bottom: 4px;
`;

const TableLabel = styled.Text<SelectedReservedProp>`
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: ${(props: SelectedReservedProp) => props.$reserved ? '#bbb' : props.$selected ? '#f68712' : '#222'};
`;

const TableStatus = styled.Text<ReservedProp>`
  font-size: 10px;
  color: ${(props: ReservedProp) => props.$reserved ? '#e67e22' : '#43b02a'};
  margin-top: 2px;
  font-weight: 700;
`;

const TableInfoBox = styled.View`
  background: #fff7ef;
  border-radius: 12px;
  padding: 14px 12px;
  flex-direction: row;
  align-items: center;
  margin-bottom: 18px;
  margin-top: 2px;
`;

const TableInfoIcon = styled.View`
  margin-right: 10px;
`;

const TableInfoText = styled.Text`
  flex: 1;
  color: #996329;
  line-height: 17px;
  font-size: 12px;
  font-weight: 600;
`;

const ContinueButtonNew = styled.TouchableOpacity<BottomInsetProp>`
  background-color: #ff8000;
  padding: 18px;
  border-radius: 12px;
  align-items: center;
  position: absolute;
  bottom: ${(props: BottomInsetProp) => Math.max(20, props.$bottomInset + 8)}px;
  width: 90%;
  align-self: center;
  shadow-color: #FF9100;
  shadow-opacity: 0.15;
  shadow-radius: 8px;
  elevation: 2;
  opacity: ${(props: any) => (props.disabled ? 0.7 : 1)};
`;

const ContinueTextNew = styled.Text`
  color: #fff;
  font-size: 16px;
  font-weight: bold;
  letter-spacing: 0.5px;
`;
// --- End Styled Components ---

const TableIconSvg = ({ color = '#222' }: { color?: string }) => (
  <Svg width={32} height={32} viewBox="0 0 128 128" fill="none">
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





const JourneyHeader = styled.View`
  padding: 22px 20px 16px;
`;
const JourneyStep = styled.Text`
  color: #bc6a26;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  margin-bottom: 8px;
`;
const JourneyTitle = styled.Text`
  font-size: 22px;
  font-weight: 800;
  color: #252a36;
  margin-bottom: 6px;
`;
const SectionSubtitle = styled.Text`
  color: #8a817b;
  font-size: 12px;
  line-height: 18px;
  margin-bottom: 8px;
`;
const PickupCard = styled.View`
  flex-direction: row;
  gap: 12px;
  background-color: #fff;
  border: 1px solid #eee5dc;
  border-radius: 16px;
  padding: 18px;
`;
