import { Icon } from './Icon';

export const StepForward = ({ size, className, ...props }) => (
    <Icon size={size} className={className} {...props}>
        <line x1="6" y1="4" x2="6" y2="20" />
        <polygon points="10 4 20 12 10 20 10 4" />
    </Icon>
);
