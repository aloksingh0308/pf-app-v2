/**
 * Test Database Indicator
 * Display a prominent badge when in TEST mode to prevent accidental changes
 */

import React from 'react';
import { IS_TEST_DATABASE } from '../config/database';
import styled from 'styled-components';

const BadgeContainer = styled.div`
  display: ${IS_TEST_DATABASE ? 'inline-flex' : 'none'};
  align-items: center;
  gap: 8px;
  background-color: #ff6b35;
  color: white;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 8px rgba(255, 107, 53, 0.3);
  animation: pulse-warning 2s ease-in-out infinite;

  @keyframes pulse-warning {
    0%, 100% {
      box-shadow: 0 2px 8px rgba(255, 107, 53, 0.3);
    }
    50% {
      box-shadow: 0 2px 16px rgba(255, 107, 53, 0.6);
    }
  }
`;

const WarningIcon = styled.span`
  font-size: 14px;
  line-height: 1;
`;

interface TestDatabaseBadgeProps {
  showIcon?: boolean;
  position?: 'inline' | 'fixed';
  className?: string;
}

/**
 * Displays a warning badge when DATABASE_MODE is TEST
 * Use this on all admin pages to prevent accidental data modifications
 *
 * @example
 * // Simple inline usage
 * <TestDatabaseBadge />
 *
 * @example
 * // With custom positioning
 * <TestDatabaseBadge position="fixed" />
 */
export const TestDatabaseBadge: React.FC<TestDatabaseBadgeProps> = ({
  showIcon = true,
  position = 'inline',
  className,
}) => {
  if (!IS_TEST_DATABASE) {
    return null;
  }

  const containerStyles = position === 'fixed' ? {
    position: 'fixed' as const,
    top: '20px',
    right: '20px',
    zIndex: 9999,
  } : {};

  return (
    <BadgeContainer style={containerStyles} className={className}>
      {showIcon && <WarningIcon>⚠️</WarningIcon>}
      <span>Test Database</span>
    </BadgeContainer>
  );
};

/**
 * Hook to check if in test mode
 * Useful for conditional rendering or warnings
 */
export const useIsTestDatabase = (): boolean => {
  return IS_TEST_DATABASE;
};

/**
 * Higher-order component to wrap admin pages with test database warning
 */
export const withTestDatabaseWarning = <P extends object>(
  Component: React.ComponentType<P>
) => {
  const WrappedWithTestDatabaseWarning = (props: P) => (
    <>
      <TestDatabaseBadge position="fixed" />
      <Component {...props} />
    </>
  );

  WrappedWithTestDatabaseWarning.displayName = `withTestDatabaseWarning(${Component.displayName || Component.name || 'Component'})`;
  return WrappedWithTestDatabaseWarning;
};
