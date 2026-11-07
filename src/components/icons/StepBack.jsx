import { Icon } from './Icon';

export const StepBack = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <line x1="18" y1="20" x2="18" y2="4" />
        <polygon points="14 20 4 12 14 4 14 20" />
    </Icon>
);
